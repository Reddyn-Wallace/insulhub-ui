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
          c_total
        }
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
        c_total
        c_deposit
        depositPercentage
        consentFee
        quoteNote
        quoteResultNote
        wall {
          SQMPrice
          SQM
          c_RValue
          c_bagCount
        }
        ceiling {
          SQMPrice
          SQM
          RValue
          downlights
          c_bagCount
        }
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
