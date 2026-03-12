export const USERS_QUERY = `
  query Users {
    users {
      results { _id firstname lastname email role }
    }
  }
`;

export const LOGIN_MUTATION = `
  mutation Login($email: String!, $password: String!) {
    loginUser(email: $email, password: $password) {
      token
      user { _id email role firstname lastname }
    }
  }
`;

export const JOBS_QUERY = `
  query Jobs($stages: [JobStage!], $skip: Int, $limit: Int, $search: String) {
    jobs(stages: $stages, skip: $skip, limit: $limit, search: $search) {
      total
      results {
        _id
        jobNumber
        stage
        createdAt
        updatedAt
        archivedAt
        lead {
          leadStatus
          allocatedTo { _id firstname lastname }
          callbackDate
          quoteBookingDate
        }
        quote {
          quoteNumber
          date
          status
          deferralDate
          c_total
        }
        installation {
          installDate
        }
        ebaForm {
          complete
          clientApproved
        }
        council {
          files_Other
          files_CouncilApprovalLetters
        }
        finalInvoice {
          _id
        }
        certificateSentAt
        client {
          contactDetails {
            name
            email
            phoneMobile
            streetAddress
            suburb
            city
            postCode
          }
        }
      }
    }
  }
`;

export const JOB_QUERY = `
  query Job($_id: ObjectId!) {
    job(_id: $_id) {
      _id
      jobNumber
      stage
      notes
      updatedAt
      archivedAt
      certificateSentAt
      lead {
        leadStatus
        leadSource
        allocatedTo { _id firstname lastname }
        callbackDate
        quoteBookingDate
      }
      quote {
        quoteNumber
        date
        status
        deferralDate
        c_total
        c_deposit
        depositPercentage
        consentFee
        quoteNote
        quoteResultNote
        extras { name price }
        wall {
          SQMPrice
          SQM
          c_RValue
          c_bagCount
          cavityDepthMeters
        }
        ceiling {
          SQMPrice
          SQM
          RValue
          downlights
          c_bagCount
        }
        files_QuoteSitePlan
      }
      ebaForm {
        complete
        clientApproved
        signature_assessor { fileName }
      }
      installation {
        installDate
        installNote
        installStatus
        checkSheetSignedAsComplete
      }
      installerChecksheet {
        _id
        complete
        budgetBags
        actualBags
        wallAreaQuoted
        wallAreaInstalled
      }
      council {
        _id
        consentNumber
        files_Other
        files_CouncilApprovalLetters
      }
      totalPriceManagerOverride
      additionalInstallments {
        _id
        amount
        date
      }
      depositInvoice {
        _id
        xeroInvoiceNumber
      }
      finalInvoice {
        _id
        xeroInvoiceNumber
      }
      additionalInstallmentInvoices {
        _id
        xeroInvoiceNumber
      }
      client {
        _id
        contactDetails {
          name
          email
          phoneMobile
          phoneSecondary
          streetAddress
          suburb
          city
          postCode
        }
        billingDetails {
          name
          email
          phoneMobile
          streetAddress
          suburb
          city
          postCode
        }
      }
    }
  }
`;
