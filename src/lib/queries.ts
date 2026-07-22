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
        }
        installation {
          installDate
          installStatus
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
      sitePlanNotes
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
          internal
        }
        ceiling {
          SQMPrice
          SQM
          RValue
          downlights
          c_bagCount
          c_thickness
        }
        files_QuoteSitePlan
      }
      ebaForm {
        complete
        clientApproved
        lotOrDPNumber
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
        contractNumber
        address
        customerName
        customerTel
        installDate
        cladding
        budgetBags
        actualBags
        wallAreaQuoted
        wallAreaInstalled
        ebaSightedAndPreInstallMaintenanceCompleted
        sampleWallCompletelyFull
        forDevelopmentWeightOfSampleWall
        actionTakenIfNotCompletelyFull
        recordBagIdentificationPhotos { _id thumbnail fileName }
        commentsOrIssues
        q0_installedIRChecked
        q1_underfloorVents
        q2_inWallToilet
        q3_loweredCeilings
        q4_unsealedMasonry
        q5_masonryJoinerySealed
        q6_noEvidenceOfLeak
        ceilingInstall_quotedArea
        ceilingInstall_quotedRValue
        ceilingInstall_quotedThickness
        ceilingInstall_numDownlightsQuoted
        ceilingInstall_numDownlightsInstalled
        ceilingInstall_haveAllDownLightsBeenLocated
        ceilingInstall_bagsRequiredForInstall
        ceilingInstall_bagsInstalled
        installerName
        signature_installer { _id thumbnail fileName }
        date
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
          lotDPNumber
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
