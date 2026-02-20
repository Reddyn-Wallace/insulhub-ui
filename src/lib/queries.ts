export const LOGIN_MUTATION = `
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      token
      me { _id name email role }
    }
  }
`;

export const JOBS_QUERY = `
  query Jobs($stages: [JobStage!], $skip: Int, $limit: Int) {
    jobs(stages: $stages, skip: $skip, limit: $limit) {
      total
      results {
        _id
        jobNumber
        stage
        updatedAt
        archivedAt
        lead {
          status
          allocatedTo { _id name }
          callbackDate
        }
        quote {
          quoteNumber
          c_total
        }
        client {
          contactDetails {
            name
            email
            mobilePhone
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
      lead {
        status
        sources
        allocatedTo { _id name }
        callbackDate
        quoteBooking
      }
      quote {
        quoteNumber
        quoteDate
        c_total
        c_deposit
        depositPercentage
        consentFee
        quoteComments
        wallInsulation
        wallSQMPrice
        wallSQM
        wallCavityDepth
        wallRValue
        wallBags
        ceilingInsulation
        ceilingSQMPrice
        ceilingSQM
        ceilingRValue
        ceilingDownlights
        ceilingBags
      }
      client {
        contactDetails {
          name
          email
          mobilePhone
          phone
          streetAddress
          suburb
          city
          postCode
        }
        billingDetails {
          name
          email
          mobilePhone
          streetAddress
          suburb
          city
          postCode
        }
      }
    }
  }
`;
