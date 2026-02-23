async function inspectJob() {
  const res = await fetch("https://api.insulhub.nz/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "query { __typename }",
    }),
  });

  const json = await res.json();
  console.log("RESULT:" + JSON.stringify(json));
}

inspectJob().catch(console.error);
