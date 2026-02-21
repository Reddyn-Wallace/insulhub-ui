const fetch = require('node-fetch');

async function introspect() {
  const query = `
    query {
      __type(name: "Query") {
        fields {
          name
          args {
            name
            type {
              name
              kind
              ofType { name kind }
            }
          }
        }
      }
    }
  `;
  
  // Need to find the server URL. I'll look at `src/lib/graphql.ts` first.
}
