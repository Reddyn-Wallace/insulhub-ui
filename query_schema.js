async function introspectQuerySchema() {
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

  const res = await fetch("https://api.insulhub.nz/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

introspectQuerySchema().catch(console.error);
