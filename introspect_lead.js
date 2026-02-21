async function introspect() {
    const query = `
    query {
      __type(name: "LeadInput") {
        inputFields {
          name
          type {
            name
            kind
            ofType {
              name
              kind
              enumValues {
                name
              }
            }
          }
        }
      }
    }
  `;
    const res = await fetch("https://api.insulhub.nz/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
    });
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
}
introspect();
