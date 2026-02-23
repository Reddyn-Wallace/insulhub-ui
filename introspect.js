async function introspect() {
  const query = `
    query {
      __type(name: "JobQuote") {
        fields {
          name
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

introspect().catch(console.error);
