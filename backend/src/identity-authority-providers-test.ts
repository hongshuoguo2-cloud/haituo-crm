import assert from "node:assert/strict";
import {
  ProviderContractError,
  normalizeProviderQuery,
  type LeadProvider,
  type ProviderCredential
} from "./provider-contract.js";
import {
  createProviderHttpClient,
  setProviderHttpTestTransport
} from "./provider-http-client.js";
import { getProvider } from "./lead-providers.js";
import { prospectOfficialIdentityMatch } from "./prospect-identity-authority-profiles.js";

function provider(id: string) {
  const item = getProvider(id);
  assert.ok(item?.search, `provider ${id} must support search`);
  return item;
}

function query(input: {
  productKeywords: string;
  countries?: string;
  goal?: string;
}) {
  return normalizeProviderQuery({
    goal: input.goal || "verify official company identity",
    productKeywords: input.productKeywords,
    countries: input.countries || "",
    industry: "",
    customerType: "",
    excludeKeywords: "",
    limit: 5
  });
}

function tools(item: LeadProvider) {
  return { http: createProviderHttpClient(item.networkPolicy) };
}

async function search(
  item: LeadProvider,
  productKeywords: string,
  credential: ProviderCredential = { apiKey: "" },
  countries = ""
) {
  return item.search!(
    { query: query({ productKeywords, countries }), cursor: "" },
    credential,
    tools(item)
  );
}

const gleif = provider("gleif");
const lei = "529900T8BM49AURSDO55";
let requestedUrl = "";
setProviderHttpTestTransport(async (url) => {
  requestedUrl = url;
  return new Response(JSON.stringify({
    data: {
      id: lei,
      attributes: {
        lei,
        entity: {
          legalName: { name: "Exact GLEIF Entity" },
          legalAddress: { country: "DE", city: "Frankfurt" },
          status: "ACTIVE"
        }
      }
    }
  }));
});
const gleifExact = await search(gleif, lei, { apiKey: "" }, "Global");
assert.equal(requestedUrl, `https://api.gleif.org/api/v1/lei-records/${lei}`);
assert.equal(gleifExact.records.length, 1);
assert.equal(gleifExact.records[0]?.providerRecordId, lei);
assert.equal(gleifExact.records[0]?.confidence, 98);

setProviderHttpTestTransport(async () => new Response("{}", { status: 404 }));
const gleifMissing = await search(gleif, `LEI:${lei}`);
assert.equal(gleifMissing.records.length, 0);
assert.match(gleifMissing.usage?.display || "", /未找到/);

setProviderHttpTestTransport(async () => new Response(JSON.stringify({
  data: {
    id: "5493001KJTIIGC8Y1R12",
    attributes: {
      lei: "5493001KJTIIGC8Y1R12",
      entity: { legalName: { name: "Wrong Entity" } }
    }
  }
})));
await assert.rejects(
  search(gleif, lei),
  (error: unknown) => error instanceof ProviderContractError
    && error.code === "PROVIDER_SCHEMA_CHANGED"
);

const companiesHouse = provider("companies_house");
const companyNumber = "01234567";
let companiesHouseAuth = "";
setProviderHttpTestTransport(async (url, init) => {
  requestedUrl = url;
  companiesHouseAuth = new Headers(init?.headers).get("authorization") || "";
  return new Response(JSON.stringify({
    company_name: "Exact UK Company Ltd",
    company_number: companyNumber,
    company_status: "active",
    registered_office_address: {
      address_line_1: "1 Test Street",
      locality: "London",
      postal_code: "SW1A 1AA"
    }
  }));
});
const companiesHouseExact = await search(
  companiesHouse,
  companyNumber,
  { apiKey: "companies-house-test-key" },
  "United Kingdom"
);
assert.equal(
  requestedUrl,
  `https://api.company-information.service.gov.uk/company/${companyNumber}`
);
assert.equal(
  companiesHouseAuth,
  `Basic ${Buffer.from("companies-house-test-key:").toString("base64")}`
);
assert.equal(companiesHouseExact.records[0]?.company, "Exact UK Company Ltd");
assert.equal(companiesHouseExact.records[0]?.providerRecordId, companyNumber);
assert.equal(companiesHouseExact.records[0]?.confidence, 98);

setProviderHttpTestTransport(async () => new Response("{}", { status: 404 }));
const companiesHouseMissing = await search(
  companiesHouse,
  companyNumber,
  { apiKey: "companies-house-test-key" }
);
assert.equal(companiesHouseMissing.records.length, 0);

setProviderHttpTestTransport(async () => new Response(JSON.stringify({
  company_name: "Wrong UK Company Ltd",
  company_number: "07654321",
  company_status: "active"
})));
await assert.rejects(
  search(companiesHouse, companyNumber, { apiKey: "companies-house-test-key" }),
  (error: unknown) => error instanceof ProviderContractError
    && error.code === "PROVIDER_SCHEMA_CHANGED"
);

const france = provider("fr_company_search");
const siren = "542051180";
setProviderHttpTestTransport(async (url) => {
  requestedUrl = url;
  return new Response(JSON.stringify({
    results: [{
      nom_complet: "Exact France SAS",
      siren,
      etat_administratif: "A",
      siege: { adresse: "2 rue de Test", siret: `${siren}00010` }
    }, {
      nom_complet: "Fuzzy Wrong France SAS",
      siren: "123456789",
      etat_administratif: "A",
      siege: null
    }],
    total_results: 2,
    page: 1,
    per_page: 5,
    total_pages: 1
  }));
});
const franceExact = await search(france, `SIREN:${siren}`, { apiKey: "" }, "France");
const franceUrl = new URL(requestedUrl);
assert.equal(franceUrl.pathname, "/search");
assert.equal(franceUrl.searchParams.get("q"), siren);
assert.equal(franceExact.records.length, 1);
assert.equal(franceExact.records[0]?.providerRecordId, `SIREN:${siren}`);
assert.equal(franceExact.records[0]?.confidence, 98);
assert.equal(franceExact.invalidCount, 1);
assert.equal(franceExact.exhausted, true);

setProviderHttpTestTransport(async () => new Response(JSON.stringify({
  results: [{
    nom_complet: "Only Fuzzy Result",
    siren: "123456789",
    etat_administratif: "A",
    siege: null
  }],
  total_results: 1,
  page: 1,
  per_page: 5,
  total_pages: 1
})));
const franceMissing = await search(france, siren, { apiKey: "" }, "France");
assert.equal(franceMissing.records.length, 0);
assert.equal(franceMissing.invalidCount, 1);
assert.match(franceMissing.usage?.display || "", /未找到/);

const kvk = provider("nl_kvk");
const kvkNumber = "04020132";
let kvkApiKey = "";
setProviderHttpTestTransport(async (url, init) => {
  requestedUrl = url;
  kvkApiKey = new Headers(init?.headers).get("apikey") || "";
  return new Response(JSON.stringify({
    kvkNummer: kvkNumber,
    naam: "VepaDrentea B.V.",
    handelsnamen: [{ naam: "Vepa, the furniture factory" }],
    sbiActiviteiten: [{
      sbiCode: "3101",
      sbiOmschrijving: "Vervaardiging van bedrijfsmeubels",
      indHoofdactiviteit: "Ja"
    }],
    _embedded: {
      hoofdvestiging: {
        eersteHandelsnaam: "Vepa, the furniture factory",
        adressen: [{ volledigAdres: "Industrieweg 31 7903AH Hoogeveen" }],
        websites: ["www.vepa.nl"]
      }
    }
  }));
});
const kvkExact = await search(
  kvk,
  `KVK:${kvkNumber}`,
  { apiKey: "kvk-test-key" },
  "Netherlands"
);
assert.equal(requestedUrl, `https://api.kvk.nl/api/v1/basisprofielen/${kvkNumber}`);
assert.equal(kvkApiKey, "kvk-test-key");
assert.equal(kvkExact.records[0]?.company, "VepaDrentea B.V.");
assert.equal(kvkExact.records[0]?.providerRecordId, `KVK:${kvkNumber}`);
assert.equal(kvkExact.records[0]?.officialWebsite, "https://www.vepa.nl");
assert.equal(kvkExact.records[0]?.confidence, 98);
const kvkIdentity = prospectOfficialIdentityMatch(
  "nl_kvk",
  "company-search",
  {
    ...kvkExact.records[0]!,
    fetchedAt: "2026-09-12T00:00:00.000Z"
  }
);
assert.equal(kvkIdentity?.subjectRef, `nl-kvk:${kvkNumber}`);
assert.equal(kvkIdentity?.identifierClaim.normalizedValue, kvkNumber);

setProviderHttpTestTransport(async () => new Response(JSON.stringify({
  pagina: 1,
  resultatenPerPagina: 10,
  totaal: 1,
  resultaten: [{
    kvkNummer: kvkNumber,
    naam: "VepaDrentea B.V.",
    type: "rechtspersoon",
    actief: "Ja",
    adres: {
      binnenlandsAdres: {
        straatnaam: "Industrieweg",
        huisnummer: 31,
        postcode: "7903AH",
        plaats: "Hoogeveen"
      }
    }
  }]
})));
const kvkByName = await search(kvk, "Vepa", { apiKey: "kvk-test-key" }, "Netherlands");
assert.equal(kvkByName.records.length, 1);
assert.equal(kvkByName.records[0]?.providerRecordId, `KVK:${kvkNumber}`);

setProviderHttpTestTransport(async () => new Response(JSON.stringify({
  kvkNummer: "12345678",
  naam: "Wrong Netherlands Company"
})));
await assert.rejects(
  search(kvk, kvkNumber, { apiKey: "kvk-test-key" }, "Netherlands"),
  (error: unknown) => error instanceof ProviderContractError
    && error.code === "PROVIDER_SCHEMA_CHANGED"
);

setProviderHttpTestTransport(null);
console.log("Identity authority provider tests passed");
