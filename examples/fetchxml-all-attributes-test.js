const fetchXml = `
  <fetch top="5">
    <entity name="contact">
      <all-attributes />
      <filter>
        <condition attribute="statecode" operator="eq" value="0" />
      </filter>
      <order attribute="fullname" />
    </entity>
  </fetch>`

async function testAllAttributesFetchXml() {
  const response = await fetch(`/_api/contacts?fetchXml=${encodeURIComponent(fetchXml)}`, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Contact FetchXML request failed: ${response.status} ${response.statusText}`)
  }

  const result = await response.json()
  console.table(result.value)
}

void testAllAttributesFetchXml().catch((error) => console.error(error))
