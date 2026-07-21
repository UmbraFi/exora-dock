const escapeGuideHTML = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

function providerContractTemplate(deliveryMode: string) {
  const mode = deliveryMode === 'cloud_direct' ? 'cloud_direct' : 'local_dock'
  return JSON.stringify({
    schemaVersion: 'exora.api-contract.v1',
    capability: {
      schemaVersion: 'exora.api.v3',
      title: 'Text Summary API',
      description: 'Accept source text and return a concise summary with verified usage.',
      deliveryMode: mode,
      interface: {
        openapi: '3.1.0',
        info: { title: 'Text Summary API', version: '1.0.0' },
        paths: {
          '/summarize': {
            post: {
              operationId: 'summarize_text',
              summary: 'Summarize submitted text',
              description: 'Returns a dynamic summary. Validation checks protocol and schema, not exact wording.',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['text'],
                      properties: {
                        text: { type: 'string', minLength: 1, maxLength: 100000, description: 'UTF-8 source text.' },
                      },
                    },
                  },
                },
              },
              responses: {
                200: {
                  description: 'Summary generated',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['summary', 'usage'],
                        properties: {
                          summary: { type: 'string', description: 'Dynamic generated summary.' },
                          usage: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['input_characters'],
                            properties: { input_characters: { type: 'integer', minimum: 1, maximum: 100000 } },
                          },
                        },
                      },
                    },
                  },
                },
                400: {
                  description: 'Invalid input',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['code', 'message'],
                        properties: { code: { const: 'invalid_text' }, message: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      runtime: {
        publicBaseUrl: mode === 'local_dock' ? 'http://127.0.0.1:3000' : 'https://api.example.com',
        healthPath: '/health',
      },
      operations: [{
        schemaVersion: 'exora.operation.v3',
        operationId: 'summarize_text',
        title: 'Summarize Text',
        description: 'Accept non-empty text and return a concise summary.',
        enabled: true,
        usage: {
          useCases: ['Condense a document for a preview.'],
          instructions: ['Send source text in the JSON text field.'],
        },
        api: {
          method: 'POST',
          path: '/summarize',
          openapiOperationRef: '#/paths/~1summarize/post',
          errors: [{ code: 'invalid_text', httpStatus: 400, description: 'Text is empty or invalid.', retryable: false }],
        },
        behavior: {
          sideEffect: { present: false, description: 'The call does not modify external state.', reversible: false, testMode: 'none' },
          idempotency: { supported: true, retentionSeconds: 86400 },
        },
        interaction: { mode: 'request_response' },
        limits: {
          timeoutSeconds: 30,
          maximumRequestBytes: 1048576,
          maximumResponseBytes: 1048576,
          maximumConcurrency: 4,
        },
        metering: {
          capabilities: [{
            dimension: 'input_characters',
            unit: 'character',
            description: 'Characters accepted from the request.',
            source: 'provider_attested',
            maximumPerInvocation: 100000,
            evidencePointer: '#/usage/input_characters',
          }],
        },
        qualification: {
          fixtures: [{
            id: 'summary_success',
            kind: 'success',
            description: 'Checks status, media type and the declared response schema.',
            request: { body: { text: 'Exora validates API contracts and settlement.' } },
            expectedProtocol: { status: 200, mediaType: 'application/json', openapiResponseRef: '#/paths/~1summarize/post/responses/200' },
            safeToRepeat: true,
          }, {
            id: 'summary_invalid_text',
            kind: 'business_error',
            description: 'Checks the declared invalid-input response.',
            request: { body: { text: '' } },
            expectedProtocol: { status: 400, mediaType: 'application/json', openapiResponseRef: '#/paths/~1summarize/post/responses/400' },
            errorCode: 'invalid_text',
            safeToRepeat: true,
          }],
        },
        dataPolicy: { inputHandling: 'transient', retentionSeconds: 0 },
        authorization: { type: 'none' },
      }],
    },
    billing: [{
      operationId: 'summarize_text',
      currency: 'USDC',
      chargeFormula: { language: 'exora.price-formula.v4', expression: 'input_characters * 0.000001 + delivered * 0.01' },
      maximumChargePerInvocationAtomic: 250000,
      settlementPolicy: 'exora.operation-settlement.v4',
    }],
  }, null, 2)
}

export function renderProviderContractGuideBody(_apiId: string, deliveryMode: string) {
  const template = escapeGuideHTML(providerContractTemplate(deliveryMode))
  return `<div class="v4-contract-guide-body">
    <nav class="v4-contract-guide-nav" aria-label="API Contract Guide sections">
      <strong>On this page</strong>
      <button type="button" data-contract-guide-section="guide-workflow">01 · Ownership &amp; workflow</button>
      <button type="button" data-contract-guide-section="guide-envelope">02 · Contract envelope</button>
      <button type="button" data-contract-guide-section="guide-capability">03 · Capability &amp; OpenAPI</button>
      <button type="button" data-contract-guide-section="guide-operation">04 · Operation definition</button>
      <button type="button" data-contract-guide-section="guide-naming">05 · Naming &amp; variables</button>
      <button type="button" data-contract-guide-section="guide-tests">06 · Seller test fixtures</button>
      <button type="button" data-contract-guide-section="guide-metering">07 · Metering &amp; billing</button>
      <button type="button" data-contract-guide-section="guide-validation">08 · Validation &amp; lifecycle</button>
      <button type="button" data-contract-guide-section="guide-agent">09 · Seller Agent rules</button>
      <button type="button" data-contract-guide-section="guide-errors">10 · Error checklist</button>
      <button type="button" data-contract-guide-section="guide-template">11 · Complete template</button>
    </nav>
    <article class="v4-contract-guide-document" data-contract-guide-document>
      <section class="v4-contract-guide-intro">
        <div><span>AUTHORITATIVE SOURCE</span><strong>One JSON file</strong><small>One <code>exora.api-contract.v1</code> binds capability, tests and billing to the stable API UID.</small></div>
        <div><span>OWNER GATE</span><strong>One confirmation</strong><small>Dock runs integration and billing validation; the owner confirms the exact tested pair once.</small></div>
        <div><span>STRICT SCHEMA</span><strong>No unknown fields</strong><small>Names are case-sensitive. Unsupported top-level and billing fields are rejected instead of ignored.</small></div>
      </section>

      <section id="guide-workflow" class="v4-contract-guide-section">
        <header><span>01</span><div><h3>Ownership and end-to-end workflow</h3><p>Who writes, tests, confirms and publishes the API.</p></div></header>
        <ol>
          <li><strong>Create or reuse one stable API Draft.</strong><span>Dock supplies the open Draft's stable <code>apiId</code> during submission. Do not put a UID inside the JSON or create a second Draft merely to revise a contract.</span></li>
          <li><strong>Assess the real API.</strong><span>Confirm delivery mode, runtime, authentication boundary, side effects, limits, response formats and seller-owned pricing intent.</span></li>
          <li><strong>Write one complete contract.</strong><span>Include the API capability, OpenAPI 3.1 interface, every Operation, safe repeatable Seller cases, trusted meters and exactly one billing rule per Operation.</span></li>
          <li><strong>Upload or submit.</strong><span>The seller may upload JSON in Dock. An authorized Agent may call <code>exora.submit_api_contract</code> with the current version and a retry-safe idempotency key.</span></li>
          <li><strong>Resolve static errors.</strong><span>Fix schema, reference, naming, fixture, meter and formula errors before asking the owner to test.</span></li>
          <li><strong>Owner runs Contract validation.</strong><span>Dock validates connectivity and declared request/response formats first, then billing scenarios in the Sandbox Ledger.</span></li>
          <li><strong>Owner confirms and operates.</strong><span>After both receipts pass, the owner confirms once, then publishes or changes lifecycle from Operations.</span></li>
        </ol>
      </section>

      <section id="guide-envelope" class="v4-contract-guide-section">
        <header><span>02</span><div><h3>Contract envelope</h3><p>The seller-authored root object has exactly three fields.</p></div></header>
        <div class="v4-contract-guide-field-grid">
          <div><code>schemaVersion</code><strong>Required constant</strong><p>Must equal <code>exora.api-contract.v1</code>.</p></div>
          <div><code>capability</code><strong>Complete API model</strong><p>One <code>exora.api.v3</code> object containing OpenAPI, runtime and Operations.</p></div>
          <div><code>billing</code><strong>One rule per Operation</strong><p>Every Operation ID must appear exactly once.</p></div>
        </div>
        <aside><strong>Strict-field rule</strong><p>Do not add root fields such as <code>channel</code>, <code>status</code>, <code>ownerConfirmation</code>, credentials or publication state. The root schema uses <code>additionalProperties: false</code>.</p></aside>
      </section>

      <section id="guide-capability" class="v4-contract-guide-section">
        <header><span>03</span><div><h3>Capability, runtime and OpenAPI 3.1</h3><p>Describe what buyers can call and what Dock can validate.</p></div></header>
        <div class="v4-contract-guide-columns">
          <div><h4>Capability fields</h4><ul><li><code>schemaVersion</code> = <code>exora.api.v3</code>.</li><li><code>title</code> is buyer-facing and concise; <code>description</code> explains real behavior and limitations.</li><li><code>deliveryMode</code> is <code>local_dock</code> or <code>cloud_direct</code>.</li><li><code>runtime.publicBaseUrl</code> is credential-free; <code>healthPath</code> begins with <code>/</code>.</li><li><code>operations</code> contains at least one complete Operation.</li></ul></div>
          <div><h4>OpenAPI requirements</h4><ul><li>Use OpenAPI <code>3.1.x</code> and give every exposed Operation an <code>operationId</code>.</li><li>Document path, query, header and body parameters with types, required flags, bounds and semantics.</li><li>Declare authoritative response schemas for every fixture status and media type.</li><li>Keep <code>api.path</code>, method and <code>openapiOperationRef</code> aligned with the OpenAPI path item.</li><li>Never place tokens, authorization headers, private keys or example secrets in the contract.</li></ul></div>
        </div>
      </section>

      <section id="guide-operation" class="v4-contract-guide-section">
        <header><span>04</span><div><h3>Operation definition</h3><p>Each independently sellable call unit is explicit and testable.</p></div></header>
        <div class="v4-contract-guide-table-wrap"><table><thead><tr><th>Area</th><th>What to declare</th></tr></thead><tbody>
          <tr><td><code>usage</code></td><td>At least one real buyer use case and one precise calling instruction.</td></tr>
          <tr><td><code>api</code></td><td>HTTP method, path, OpenAPI reference and stable business-error catalog with status and retryability.</td></tr>
          <tr><td><code>behavior</code></td><td>Side effects, reversibility, safe test mode, idempotency support and retention window.</td></tr>
          <tr><td><code>interaction</code></td><td><code>request_response</code>, <code>server_stream</code> or <code>async_job</code>. Streaming requires event/completion/error/sequence fields; async jobs require job/status pointers, poll path, terminal states and maximum wait.</td></tr>
          <tr><td><code>artifacts</code></td><td>For file outputs, declare field names, MIME types, maximum bytes, SHA-256 field and optional expiry field.</td></tr>
          <tr><td><code>limits</code></td><td>Timeout, maximum request/response bytes and the hard concurrency ceiling. Sellers choose the live open-concurrency value later in Operations, without changing this contract.</td></tr>
          <tr><td><code>metering</code></td><td>Only measurements that Dock or the provider can prove, each with a unit and per-invocation maximum.</td></tr>
          <tr><td><code>qualification</code></td><td>Safe repeatable Seller cases covering success and every relevant error, stream, async or artifact path.</td></tr>
          <tr><td><code>dataPolicy</code> / <code>authorization</code></td><td>Document handling, retention and authorization requirements without including credential values.</td></tr>
        </tbody></table></div>
      </section>

      <section id="guide-naming" class="v4-contract-guide-section">
        <header><span>05</span><div><h3>Naming, references and variables</h3><p>Stable names are part of the contract hash and billing interface.</p></div></header>
        <div class="v4-contract-guide-field-grid">
          <div><code>apiId</code><strong>Dock-managed</strong><p>Do not include it in the JSON. Dock injects the stable UID of the Draft receiving the submission.</p></div>
          <div><code>operationId</code><strong>Stable and unique</strong><p>Pattern: <code>^[A-Za-z][A-Za-z0-9._-]{0,127}$</code>. Prefer lower snake case such as <code>summarize_text</code>.</p></div>
          <div><code>fixture.id</code><strong>Intent-revealing</strong><p>Same identifier pattern. Prefer <code>summary_success</code> or <code>invalid_text</code>.</p></div>
          <div><code>metering.dimension</code><strong>Formula variable</strong><p>Pattern: <code>^[A-Za-z_][A-Za-z0-9_]*$</code>. Prefer singular snake case such as <code>input_token</code> or <code>page</code>.</p></div>
          <div><code>error.code</code><strong>Stable machine code</strong><p>Prefer lower snake case. The fixture <code>errorCode</code> must match the declared catalog entry.</p></div>
          <div><code>openapiOperationRef</code><strong>JSON Pointer</strong><p>Use <code>#/paths/~1summarize/post</code>; encode <code>/</code> as <code>~1</code>.</p></div>
        </div>
        <aside><strong>Reserved variable</strong><p><code>delivered</code> is supplied by Exora Cloud: <code>1</code> after successful delivery and <code>0</code> after execution cancellation. Never declare it as a seller meter.</p></aside>
      </section>

      <section id="guide-tests" class="v4-contract-guide-section">
        <header><span>06</span><div><h3>Seller test fixtures</h3><p>Fixtures prove protocol behavior without pretending dynamic business results are deterministic.</p></div></header>
        <ul class="v4-contract-guide-checklist"><li>Include at least one <code>success</code> fixture per Operation.</li><li>Add <code>business_error</code>, <code>stream</code>, <code>async_complete</code>, <code>async_cancel</code> and <code>artifact</code> fixtures whenever those paths exist.</li><li>Every fixture must set <code>safeToRepeat: true</code>. Use dry-run, sandbox, test accounts or rollback for side-effecting calls.</li><li><code>request</code> may contain body, query and non-secret headers.</li><li><code>expectedProtocol</code> declares only status, media type and an OpenAPI response reference.</li><li>Do not assert summaries, classifications, generated text, timestamps, IDs, balances or other dynamic business values.</li><li>A business-error fixture supplies an <code>errorCode</code> matching <code>api.errors</code>.</li></ul>
      </section>

      <section id="guide-metering" class="v4-contract-guide-section">
        <header><span>07</span><div><h3>Trusted metering and billing</h3><p>Every formula input must be bounded and verifiable.</p></div></header>
        <div class="v4-contract-guide-columns"><div><h4>Meter declaration</h4><ul><li><code>dimension</code>, <code>unit</code>, description and <code>maximumPerInvocation</code> are required.</li><li><code>source: cloud</code> is measured by Exora; <code>provider_attested</code> requires an <code>evidencePointer</code>.</li><li>Use only real meters. For fixed pricing, leave capabilities empty instead of inventing a <code>request</code> meter.</li><li>Formula variables are exactly the verified dimensions plus reserved <code>delivered</code>.</li></ul></div><div><h4>Billing rule</h4><ul><li>Exactly one rule per Operation; <code>operationId</code> must match exactly.</li><li><code>currency</code> = <code>USDC</code>; language = <code>exora.price-formula.v4</code>; settlement = <code>exora.operation-settlement.v4</code>.</li><li><code>maximumChargePerInvocationAtomic</code> is a positive atomic-USDC cap.</li><li>Supported formula tools include arithmetic, comparisons, <code>min</code>, <code>max</code>, <code>ceil</code>, <code>floor</code>, <code>if</code>, <code>and</code>, <code>or</code> and <code>not</code>.</li><li>Divisors must be positive constants; every legal input must produce a bounded non-negative result.</li></ul></div></div>
        <aside><strong>Commercial authority</strong><p>A Seller Agent may encode rates explicitly supplied by the seller. It must never invent, choose or recommend prices or caps.</p></aside>
      </section>

      <section id="guide-validation" class="v4-contract-guide-section">
        <header><span>08</span><div><h3>Validation, confirmation and lifecycle</h3><p>Submission does not authorize execution or publication.</p></div></header>
        <div class="v4-contract-guide-flow"><div><span>1</span><strong>Static contract checks</strong><small>Schema, strict fields, references, Operation coverage, meters and formulas.</small></div><div><span>2</span><strong>Integration validation</strong><small>Health, connectivity, fixtures, HTTP protocol and declared OpenAPI response formats.</small></div><div><span>3</span><strong>Billing validation</strong><small>Formula preflight and settlement cases in the no-real-USDC Sandbox Ledger.</small></div><div><span>4</span><strong>Owner confirmation</strong><small>Locks the exact integration and billing projections derived from the same source hash.</small></div><div><span>5</span><strong>Operations</strong><small>The owner publishes, monitors and controls <code>offline</code>, <code>live</code> and <code>draining</code>.</small></div></div>
        <aside><strong>Source changes invalidate evidence</strong><p>Replacing a confirmed contract clears both receipts and requires both automatic validations and owner confirmation again. Live or draining Operations must be taken offline before the contract changes.</p></aside>
      </section>

      <section id="guide-agent" class="v4-contract-guide-section">
        <header><span>09</span><div><h3>Seller Agent instructions and authority boundary</h3><p>Use Exora MCP as the current preparation manual.</p></div></header>
        <ol><li><strong>Start with the guide.</strong><span>Call <code>exora.get_api_preparation_guide</code> with the closest starting point and delivery mode, then follow every evidence requirement in order.</span></li><li><strong>Work only from authorized material.</strong><span>Inspect seller-approved code, CLI, OpenAPI or HTTP behavior. Stop and ask when behavior, rights, pricing or safe test data are unknown.</span></li><li><strong>Assemble the complete object.</strong><span>Do not submit partial fragments. Remove secrets, unresolved placeholders and unsupported fields.</span></li><li><strong>Submit in place.</strong><span>Call <code>exora.submit_api_contract</code> with the existing <code>apiId</code>, current <code>expectedVersion</code>, complete <code>contract</code> and a unique retry-safe <code>idempotencyKey</code>.</span></li><li><strong>Stop after static issues are resolved.</strong><span>An Agent cannot run validation, confirm the contract, approve execution, publish, choose prices or change lifecycle.</span></li></ol>
      </section>

      <section id="guide-errors" class="v4-contract-guide-section">
        <header><span>10</span><div><h3>Pre-submission error checklist</h3><p>Check these before uploading or calling MCP.</p></div></header>
        <ul class="v4-contract-guide-checklist"><li>The root contains only <code>schemaVersion</code>, <code>capability</code> and <code>billing</code>; neither the root nor capability needs an <code>apiId</code>.</li><li>Dock injects the current Draft UID and every schema version is exact.</li><li>Every Operation ID matches OpenAPI, its billing rule and all references.</li><li>Every fixture response status and media type exists in OpenAPI.</li><li>Every fixture is safe to repeat and avoids dynamic-value assertions.</li><li>Every provider-attested meter has an evidence pointer and a truthful maximum.</li><li>Every formula references only declared meters or <code>delivered</code>, and every Operation has exactly one billing rule.</li><li>No tokens, passwords, cookies, private keys, authorization headers, owner decisions or publication state are present.</li><li>No unresolved placeholders remain.</li></ul>
      </section>

      <section id="guide-template" class="v4-contract-guide-section v4-contract-guide-template-section">
        <header><span>11</span><div><h3>Complete request-response template</h3><p>Copy, replace the example semantics with the real API, and keep the stable API UID.</p></div><button type="button" data-copy-contract-guide-template>Copy JSON</button></header>
        <pre data-contract-guide-template>${template}</pre>
      </section>
    </article>
  </div>`
}
