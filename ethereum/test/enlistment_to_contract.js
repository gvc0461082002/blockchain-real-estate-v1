const structEqual = require('./helpers').structEqual;
const bigNumberEqual = require('./helpers').bigNumberEqual;
const expectThrowMessage = require('./helpers').expectThrowMessage;
const ETC = artifacts.require("EnlistmentToContract");
const web3 = require('web3');
const util = require('util');
const web3utils = require('web3-utils');

/* tests run very unstable: sometimes all pass, sometimes there are multiple fails */

const offerStatusMap = {
  'PENDING': 0,
  'REJECTED': 1,
  'CANCELLED': 2,
  'ACCEPTED': 3
};

const agreementStatusMap = {
  'UNINITIALIZED': 0,
  'PENDING': 1,
  'REJECTED': 2,
  'CONFIRMED': 3,
  'CANCELLED': 4,
  'LANDLORD_SIGNED': 5,
  'TENANT_SIGNED': 6,
  'COMPLETED': 7
};

const revertErrorMsg = 'VM Exception while processing transaction: revert';

contract('EnlistmentToContract', async ([owner]) => {

  contract('Enlistment/contract creation', async () => {

    let contract;

    before(async () => {
      contract = await ETC.new('landlord@email.xd', 'Waker', 3, 2, 1, 15000);
    });

    it('should deploy a contract instance', async () => {
      assert.isOk(contract.address);
    });

    it('should instantiate the landlord property', async () => {
      let landlord = await contract.landlord.call();
      assert.equal(landlord, 'landlord@email.xd');
    });

    it('should instanciate the enlistment', async () => {
      let enlistment = await contract.enlistment.call(); // returns an array which represents an enlistment struct
      assert.equal(enlistment[0], 'Waker');
      assert.equal(enlistment[1], 3);
      assert.equal(enlistment[2], 2);
      assert.equal(enlistment[3], 1);
      assert.equal(enlistment[4], 15000);
    });
  });

  contract('Offer flow', async () => {

    describe('Sending', async () => {

      let instance;
      let sendTx1;
      let sendTx2;

      before('create an enlistment and send offers', async () => {
        instance = await ETC.new('john@wick.xd', 'Baker', 1, 2, 3, 45000);
        sendTx1 = await instance.sendOffer(100, 'Winston', 'winston@noreply.xd');
        sendTx2 = await instance.sendOffer(20, 'Ares', 'ares@willreply.xd');
      });

      it('should successfully retrieve multiple offers', async () => {
        assert.isOk(sendTx1);
        assert.isOk(sendTx2);
      });

      it('should get offers by sender email address', async () => {
        let offer1 = await instance.getOffer('winston@noreply.xd'); // should return struct in the form of [initialized, amount, tenantName, tenantEmail, status]
        let offer2 = await instance.getOffer('ares@willreply.xd');

        structEqual(offer1, [true, 100, 'Winston', 'winston@noreply.xd', offerStatusMap['PENDING']]);
        structEqual([true, 20, 'Ares', 'ares@willreply.xd', offerStatusMap['PENDING']], offer2);
      });

      //explicit
      it('should set new offer status to PENDING', async () => {
        let offer1 = await instance.getOffer('winston@noreply.xd');
        assert.equal(offer1[4], offerStatusMap['PENDING']);
      });

      // NOTE: allowing update txs are costly for a provider
      it('should not allow updating the offer size', async () => {
        await expectThrowMessage(instance.sendOffer(1000, 'Winston', 'winston@noreply.xd'), revertErrorMsg);
      });

    });

    describe('Responding with a resolution', async () => {

      let instance;

      beforeEach('create an enlistment and send offer', async () => {
        instance = await ETC.new('john@wick.xd', 'Baker', 1, 2, 3, 45000);
        await instance.sendOffer(400, 'Cassian', 'cassian@reply.xd');
      });

      it('should accept the pending offer', async () => {
        await instance.reviewOffer(true, 'cassian@reply.xd');
        const offer = await instance.getOffer('cassian@reply.xd');
        bigNumberEqual(offer[4], offerStatusMap['ACCEPTED']);
      });

      it('should reject the pending offer', async () => {
        await instance.reviewOffer(false, 'cassian@reply.xd');
        const offer = await instance.getOffer('cassian@reply.xd');
        bigNumberEqual(offer[4], offerStatusMap['REJECTED']);
      });

    });

    describe('Offer follow-ups', async () => {

      let instance;
      beforeEach('create an enlistment and send offer', async () => {
        instance = await ETC.new('john@wick.xd', 'Baker', 1, 2, 3, 45000);
        await instance.sendOffer(400, 'Cassian', 'cassian@reply.xd');
      });

      it('should allow sending a new offer after the old one was rejected', async () => {
        await instance.reviewOffer(false, 'cassian@reply.xd');
        await instance.sendOffer(450, 'Cassian', 'cassian@reply.xd'); // fails, needs fix
      });

      it('should allow cancelling an offer for tenant until he has signed. In this case, process flow pauses where it is (agreement may be accepted), and waits for an offer to be sent and accepted again. Essentially, this resets the OfferToContract subprocess.');

      it('should allow rejecting an offer for landlord until he has signed. In this case, process flow pauses where it is (agreement may be accepted), and waits for an offer to be sent and accepted again. Essentially, this resets the OfferToContract subprocess.');

      it('should allow sending a new offer after the old one was cancelled');

    });

  });

  contract('Agreement contract flow', async () => {

    describe('Submitting drafts', async () => {

      let instance;

      beforeEach('create an enlistment, send an offer', async () => {
        instance = await ETC.new('johna@wick.xd', 'Baker', 1, 2, 3, 45000);
        await instance.sendOffer(400, 'Cassian', 'cassian@reply.xd');
      });

      it('should allow draft submissions for accepted offers', async () => {
        await instance.reviewOffer(true, 'cassian@reply.xd');
        await instance.submitDraft('cassian@reply.xd', 'John Wick', 'Cassian', 'cassian@reply.xd', 1519580655493, 1519580355498, 65493, 'No cats, no wives', 'draftPDFH4sh');
        //const status = await instance.getAgreementStatus('cassian@reply.xd');
        //bigNumberEqual(agreementStatusMap['PENDING'], status);
      });

      it('should not allow draft submissions for rejected offers', async () => {
        await instance.reviewOffer(false, 'cassian@reply.xd');
        await expectThrowMessage(
          instance.submitDraft('cassian@reply.xd', 'John Wick', 'Cassian', 'cassian@reply.xd', 1519580655493, 1519580355498, 65493, 'No cats, no wives', 'draftPDFH4sh'),
          revertErrorMsg);
      });

      //NOTE: not allowed due to the reason that a tenant may agree with a draft that has changed only moments before he/she accepts. Could be tackled with non-blockchain techniques as well as providing a hash with the accept request for version checks
      it('should not allow draft updates for a submitted pending draft');

      describe('retrieving agreements', async () => {
        beforeEach('review and submit draft', async () => {
          await instance.reviewOffer(true, 'cassian@reply.xd');
          await instance.submitDraft('cassian@reply.xd', 'John Wick', 'Cassian', 'cassian@reply.xd', 1519580655493, 1519580355498, 65493, 'No cats, no wives', 'draftPDFH4sh');
        });

        describe('should get agreements by sender email address', async () => {
          it('Multi-part requests: participants', async () => {
            const agreementParticipants = await instance.getAgreementParticipants('cassian@reply.xd'); // returns struct in the form of [landlordName, tenantName, tenantEmail]
            structEqual(['John Wick', 'Cassian', 'cassian@reply.xd'], agreementParticipants);
          });

          it('Multi-part requests: details', async () => {
            const agreementDetails = await instance.getAgreementDetails('cassian@reply.xd'); // returns struct in the form of [amount, leaseStart, handoverDate, leasePeriod, otherTerms]
            structEqual([400, 1519580655493, 1519580355498, 65493, 'No cats, no wives'], agreementDetails);
          });

          it('Multi-part requests: hashes', async () => {
            const agreementHashes = await instance.getAgreementHashes('cassian@reply.xd'); // returns struct in the form of [unsignedHash, landlordSignedHash, tenantSignedHash]
            structEqual(['draftPDFH4sh', '', ''], agreementHashes);
          });

          it('Multi-part requests: status', async() => {
            const agreementStatus = await instance.getAgreementStatus('cassian@reply.xd'); // returns BigNumber integer, representing the associated enum
            bigNumberEqual(agreementStatusMap['PENDING'], agreementStatus);
          })
        });

      });

    });

    describe('Responding with a resolution', async () => {
      let instance;

      beforeEach('create an enlistment, send an offer', async () => {
        instance = await ETC.new('john@wick.xd', 'Baker', 1, 2, 3, 45000);
        await instance.sendOffer(400, 'Cassian', 'cassian@reply.xd');
        await instance.reviewOffer(true, 'cassian@reply.xd');
        await instance.submitDraft('cassian@reply.xd', 'John Wick', 'Cassian', 'cassian@reply.xd', 1519580655493, 1519580355498, 65493, 'No cats, no wives', 'draftPDFH4sh');
      });

      it('should accept the pending draft', async () => {
        await instance.reviewAgreement('cassian@reply.xd', true);
        const agreementStatus = await instance.getAgreementStatus('cassian@reply.xd');
        bigNumberEqual(agreementStatusMap['CONFIRMED'], agreementStatus);
      });

      it('should reject the pending draft', async () => {
        await instance.reviewAgreement('cassian@reply.xd', false);
        const agreementStatus = await instance.getAgreementStatus('cassian@reply.xd');
        bigNumberEqual(agreementStatusMap['REJECTED'], agreementStatus);
      });

    });

    describe('Agreement follow-ups', async () => {
      let instance;

      beforeEach('create an enlistment, send an offer, accept the offer, submit a draft', async () => {
        instance = await ETC.new('john@wick.xd', 'Baker', 1, 2, 3, 45000);
        await instance.sendOffer(400, 'Cassian', 'cassian@reply.xd');
        await instance.reviewOffer(true, 'cassian@reply.xd');
        await instance.submitDraft('cassian@reply.xd', 'John Wick', 'Cassian', 'cassian@reply.xd', 1519580655493, 1519580355498, 65493, 'No cats, no wives', 'draftPDFH4sh');
      });

      it('should allow sending a new agreement draft after the old one was rejected', async () => {
        await instance.reviewAgreement('cassian@reply.xd', false);
        await instance.submitDraft('cassian@reply.xd', 'John Wick', 'Cassian', 'cassian@reply.xd', 1519580655493, 1519580355498, 85493, 'No dogs', 'N3WdraftPDFH4sh');

        const agreementStatus = await instance.getAgreementStatus('cassian@reply.xd');
        bigNumberEqual(agreementStatusMap['PENDING'], agreementStatus);

        const agreementHashes = await instance.getAgreementHashes('cassian@reply.xd');
        assert.equal(agreementHashes[0], 'N3WdraftPDFH4sh');
      });

      it('should allow withdrawing an agreement draft (for landlord) until he has signed it. in this case, process flow moves back to the place where the landlord is supposed to send a contract draft.');

      it('should allow rejecting an agreement draft (for tenant) until he has signed it. in this case, process flow moves back to the place where the landlord is supposed to send a contract draft');

      it('should allow sending a new draft after the old one was withdrawn');

    });

    describe('Signing', async () => {
      let instance;

      beforeEach('create an enlistment, send an offer, accept the offer, submit a draft, accept the draft', async () => {
        instance = await ETC.new('john@wick.xd', 'Baker', 1, 2, 3, 45000);
        await instance.sendOffer(400, 'Cassian', 'cassian@reply.xd');
        await instance.reviewOffer(true, 'cassian@reply.xd');
        await instance.submitDraft('cassian@reply.xd', 'John Wick', 'Cassian', 'cassian@reply.xd', 1519580655493, 1519580355498, 65493, 'No cats, no wives', 'draftPDFH4sh');
        await instance.reviewAgreement('cassian@reply.xd', true);
      });

      it('should sign the contract: landlord', async () => {
        await instance.landlordSignAgreement('cassian@reply.xd', 'l4ndl0rdSignedDraftPDFH4sh');

        const agreementStatus = await instance.getAgreementStatus('cassian@reply.xd');
        bigNumberEqual(agreementStatusMap['LANDLORD_SIGNED'], agreementStatus);

        const agreementHashes = await instance.getAgreementHashes('cassian@reply.xd');
        assert.equal(agreementHashes[1], 'l4ndl0rdSignedDraftPDFH4sh');
      });

      it('should sign the contract: tenant', async() => {
        await instance.landlordSignAgreement('cassian@reply.xd', 'l4ndl0rdSignedDraftPDFH4sh');
        await instance.tenantSignAgreement('cassian@reply.xd', 't3n4ntSignedDraftPDFH4sh');

        const agreementStatus = await instance.getAgreementStatus('cassian@reply.xd');
        bigNumberEqual(agreementStatusMap['TENANT_SIGNED'], agreementStatus);

        const agreementHashes = await instance.getAgreementHashes('cassian@reply.xd');
        assert.equal(agreementHashes[2], 't3n4ntSignedDraftPDFH4sh');
      });
    });

    describe('Collecting the first month rent', async () => {
      let instance;

      beforeEach('create an enlistment, send an offer, accept the offer, submit a draft, accept the draft, landlord sign, tenant sign', async () => {
        instance = await ETC.new('john@wick.xd', 'Baker', 1, 2, 3, 45000);
        await instance.sendOffer(400, 'Cassian', 'cassian@reply.xd');
        await instance.reviewOffer(true, 'cassian@reply.xd');
        await instance.submitDraft('cassian@reply.xd', 'John Wick', 'Cassian', 'cassian@reply.xd', 1519580655493, 1519580355498, 65493, 'No cats, no wives', 'draftPDFH4sh');
        await instance.reviewAgreement('cassian@reply.xd', true);
        await instance.landlordSignAgreement('cassian@reply.xd', 'l4ndl0rdSignedDraftPDFH4sh');
        await instance.tenantSignAgreement('cassian@reply.xd', 't3n4ntSignedDraftPDFH4sh');
      });

      it('should finish the process upon receiving rent', async () => {
        await instance.receiveFirstMonthRent('cassian@reply.xd');

        const agreementStatus = await instance.getAgreementStatus('cassian@reply.xd');

        bigNumberEqual(agreementStatusMap['COMPLETED'], agreementStatus);
      });
    });

  });

});