export const UPDATE_JOB_LEAD = `
  mutation UpdateJobLead($input: UpdateJobInput!) {
    updateJob(input: $input) {
      _id
      stage
      notes
      lead {
        leadStatus
        leadSource
        allocatedTo { _id firstname lastname }
        callbackDate
        quoteBookingDate
      }
    }
  }
`;

export const UPDATE_JOB_STAGE = `
  mutation UpdateJobStage($input: UpdateJobInput!) {
    updateJob(input: $input) { _id stage }
  }
`;

export const UPDATE_JOB_NOTES = `
  mutation UpdateJobNotes($input: UpdateJobInput!) {
    updateJob(input: $input) { _id notes }
  }
`;

export const UPDATE_JOB_QUOTE = `
  mutation UpdateJobQuote($input: UpdateJobInput!, $emailQuoteToCustomer: Boolean, $quotePDFEmailBodyTemplate: String) {
    updateJob(input: $input, emailQuoteToCustomer: $emailQuoteToCustomer, quotePDFEmailBodyTemplate: $quotePDFEmailBodyTemplate) {
      _id
      stage
      quote {
        quoteNumber
        date
        c_total
        c_deposit
        depositPercentage
        consentFee
        quoteNote
        quoteResultNote
        wall { SQMPrice SQM c_RValue c_bagCount }
        ceiling { SQMPrice SQM RValue downlights c_bagCount }
      }
    }
  }
`;

export const ARCHIVE_JOB = `
  mutation ArchiveJob($_id: ObjectId!) {
    archiveJob(_id: $_id)
  }
`;

export const UPDATE_CLIENT = `
  mutation UpdateClient($_id: ObjectId!, $input: UpdateClientInput!) {
    updateClient(_id: $_id, input: $input) { _id }
  }
`;

export const CREATE_JOB = `
  mutation CreateJob($input: CreateJobInput!) {
    createJob(input: $input) {
      _id
      jobNumber
      stage
      client { contactDetails { name phoneMobile email } }
    }
  }
`;

export const SEND_EBA = `
  mutation SendEBA($jobId: ObjectId!) {
    sendEBAEmail(jobId: $jobId)
  }
`;

export const ADD_FILES = `
  mutation AddFiles($_id: ObjectId!, $documentType: UploadedFileType!, $fileNames: [String!]!) {
    addFiles(_id: $_id, documentType: $documentType, fileNames: $fileNames)
  }
`;

export const REMOVE_FILE = `
  mutation RemoveFile($_id: ObjectId!, $documentType: UploadedFileType!, $fileName: String!) {
    removeFile(_id: $_id, documentType: $documentType, fileName: $fileName)
  }
`;
