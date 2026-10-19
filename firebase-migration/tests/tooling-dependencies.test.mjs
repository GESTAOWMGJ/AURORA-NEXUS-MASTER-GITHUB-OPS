/**
 * Regression coverage for the scoped Firebase CLI 15.34.0 -> Pub/Sub 5.3.1 ->
 * OpenTelemetry core 2.8.0 override. Resolve from the actual consuming module:
 * an unrelated, corrected top-level copy must not hide a vulnerable nested copy.
 * These tests exercise local propagation only; no Pub/Sub client, exporter,
 * emulator, credentials, or network connection is needed.
 * Advisory: https://github.com/advisories/GHSA-8988-4f7v-96qf
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const cliManifestPath = require.resolve('firebase-tools/package.json');
const cliRequire = createRequire(cliManifestPath);
const pubsubManifestPath = cliRequire.resolve('@google-cloud/pubsub/package.json');
const pubsubRequire = createRequire(pubsubManifestPath);
const tracingPath = pubsubRequire.resolve('./build/src/telemetry-tracing.js');
const tracingRequire = createRequire(tracingPath);
const coreManifestPath = tracingRequire.resolve('@opentelemetry/core/package.json');
const core = tracingRequire('@opentelemetry/core');
const api = tracingRequire('@opentelemetry/api');
const pubsubTracing = pubsubRequire(tracingPath);

const readManifest = (path) => JSON.parse(readFileSync(path, 'utf8'));
const traceContext = Object.freeze({
  traceId: '0123456789abcdef0123456789abcdef',
  spanId: '0123456789abcdef',
  traceFlags: api.TraceFlags.SAMPLED,
  traceState: new core.TraceState('vendor=synthetic')
});
const traceparent = `00-${traceContext.traceId}-${traceContext.spanId}-01`;
const subscription = 'projects/synthetic-project/subscriptions/synthetic-subscription';

test('the Firebase CLI consumer loads the pinned corrected OpenTelemetry core', () => {
  assert.equal(readManifest(cliManifestPath).version, '15.34.0');
  assert.equal(readManifest(pubsubManifestPath).version, '5.3.1');
  assert.equal(readManifest(coreManifestPath).version, '2.8.0');
  assert.ok(Number(process.versions.node.split('.')[0]) >= 22,
    'this test package and the corrected core require the configured Node 22+ runtime');
  assert.strictEqual(createRequire(coreManifestPath)('@opentelemetry/api'), api,
    'Pub/Sub and the core it loads must share the compatible OpenTelemetry API');
});

test('Pub/Sub trace propagation remains compatible with the scoped override',
  { concurrency: false }, async (t) => {
    const enabledBefore = pubsubTracing.isEnabled() !== pubsubTracing.OpenTelemetryLevel.None;
    pubsubTracing.setGloballyEnabled(true);
    t.after(() => pubsubTracing.setGloballyEnabled(enabledBefore));
    const propagator = new core.W3CTraceContextPropagator();

    await t.test('injectSpan and extractSpan roundtrip real Pub/Sub attributes', () => {
      const sourceSpan = api.trace.wrapSpanContext(traceContext);
      const outbound = { attributes: { application: 'preserved' } };
      pubsubTracing.injectSpan(sourceSpan, outbound);

      assert.equal(pubsubTracing.pubsubGetter.get(outbound, 'traceparent'), traceparent);
      assert.equal(pubsubTracing.pubsubGetter.get(outbound, 'tracestate'), 'vendor=synthetic');
      assert.equal(outbound.attributes.application, 'preserved');
      assert.strictEqual(outbound.parentSpan, sourceSpan);

      // A received message has attributes but no local parentSpan shortcut.
      const inbound = { attributes: { ...outbound.attributes } };
      const extracted = propagator.extract(api.ROOT_CONTEXT, inbound, pubsubTracing.pubsubGetter);
      const parent = api.trace.getSpanContext(extracted);
      assert.equal(parent.traceId, traceContext.traceId);
      assert.equal(parent.spanId, traceContext.spanId);
      assert.equal(parent.traceFlags, api.TraceFlags.SAMPLED);
      assert.equal(parent.isRemote, true);
      assert.equal(parent.traceState.serialize(), 'vendor=synthetic');

      // The API's default non-recording tracer preserves this valid parent;
      // no SDK provider or exporter is registered for these local tests.
      const received = pubsubTracing.extractSpan(inbound, subscription);
      assert.ok(received);
      assert.equal(received.spanContext().traceId, traceContext.traceId);
      assert.equal(received.spanContext().spanId, traceContext.spanId);
      assert.strictEqual(inbound.parentSpan, received);
      received.end();
    });

    const invalidParents = {
      malformed: 'not-a-traceparent',
      'zero trace ID': `00-${'0'.repeat(32)}-${traceContext.spanId}-01`,
      'zero span ID': `00-${traceContext.traceId}-${'0'.repeat(16)}-01`,
      'forbidden version': `ff-${traceContext.traceId}-${traceContext.spanId}-01`,
      'extra version-00 field': `${traceparent}-extra`
    };
    for (const [label, value] of Object.entries(invalidParents)) {
      await t.test(`extractSpan rejects an invalid traceparent: ${label}`, () => {
        const inbound = { attributes: {} };
        pubsubTracing.pubsubSetter.set(inbound, 'traceparent', value);
        const extracted = propagator.extract(api.ROOT_CONTEXT, inbound, pubsubTracing.pubsubGetter);
        assert.equal(api.trace.getSpanContext(extracted), undefined);

        const received = pubsubTracing.extractSpan(inbound, subscription);
        assert.ok(received);
        assert.equal(api.isSpanContextValid(received.spanContext()), false);
        received.end();
      });
    }

    await t.test('the active trace-context route neither injects nor reads baggage', () => {
      const contextWithBaggage = api.propagation.setBaggage(
        api.trace.setSpanContext(api.ROOT_CONTEXT, traceContext),
        api.propagation.createBaggage({ synthetic: { value: 'retained-locally' } })
      );
      const outbound = { attributes: {} };
      propagator.inject(contextWithBaggage, outbound, pubsubTracing.pubsubSetter);
      assert.equal(pubsubTracing.pubsubGetter.get(outbound, 'baggage'), undefined);
      assert.equal(pubsubTracing.pubsubGetter.get(outbound, 'traceparent'), traceparent);

      let baggageReads = 0;
      const inbound = { attributes: { ...outbound.attributes } };
      // Input accessors detect reads without replacing any library function.
      for (const name of ['baggage', 'googclient_baggage']) {
        Object.defineProperty(inbound.attributes, name, {
          enumerable: true,
          get() {
            baggageReads += 1;
            return 'synthetic=' + 'x'.repeat(4097);
          }
        });
      }
      const extracted = propagator.extract(api.ROOT_CONTEXT, inbound, pubsubTracing.pubsubGetter);
      assert.equal(api.propagation.getBaggage(extracted), undefined);
      const received = pubsubTracing.extractSpan(inbound, subscription);
      assert.equal(received.spanContext().traceId, traceContext.traceId);
      assert.equal(baggageReads, 0, 'Pub/Sub trace propagation must not parse baggage');
      received.end();
    });
  });

const baggagePropagator = new core.W3CBaggagePropagator();

function baggageEntries(header) {
  // Keep all regression inputs small, ASCII, and independent of heap/timing.
  const serialized = Array.isArray(header) ? header.join(',') : header;
  assert.match(serialized, /^[\x20-\x7e]*$/);
  assert.ok(Buffer.byteLength(serialized, 'utf8') < 20_000);
  const extracted = baggagePropagator.extract(
    api.ROOT_CONTEXT, { baggage: header }, api.defaultTextMapGetter
  );
  return new Map(api.propagation.getBaggage(extracted)?.getAllEntries() ?? []);
}

function entryWithBytes(key, bytes) {
  return `${key}=${'x'.repeat(bytes - key.length - 1)}`;
}

// Expected limits come from the advisory, not from the implementation constants.
// Each over-limit assertion fails with the unbounded core 1.30.1 extractor.
for (const shape of ['scalar', 'array']) {
  const asHeader = (entries) => shape === 'array' ? entries : entries.join(',');

  test(`baggage ${shape}: ordinary entries and metadata survive extraction`, () => {
    const entries = baggageEntries(asHeader(['synthetic=value;source=test', 'other=ok']));
    assert.equal(entries.size, 2);
    assert.equal(entries.get('synthetic').value, 'value');
    assert.equal(entries.get('synthetic').metadata.toString(), 'source=test');
    assert.equal(entries.get('other').value, 'ok');
  });

  test(`baggage ${shape}: accepts 180 entries and stops before entry 181`, () => {
    const pairs = Array.from({ length: 181 }, (_, i) => `k${String(i).padStart(3, '0')}=v`);
    const atLimit = baggageEntries(asHeader(pairs.slice(0, 180)));
    assert.equal(atLimit.size, 180);
    assert.equal(atLimit.get('k179').value, 'v');

    const aboveLimit = baggageEntries(asHeader(pairs));
    assert.equal(aboveLimit.size, 180);
    assert.equal(aboveLimit.get('k000').value, 'v');
    assert.equal(aboveLimit.get('k179').value, 'v');
    assert.equal(aboveLimit.has('k180'), false);
  });

  test(`baggage ${shape}: accepts a 4096-byte entry and skips a 4097-byte entry`, () => {
    const accepted = baggageEntries(asHeader([entryWithBytes('atLimit', 4096), 'control=ok']));
    assert.equal(accepted.get('atLimit').value.length, 4096 - 'atLimit='.length);
    assert.equal(accepted.get('control').value, 'ok');

    const rejected = baggageEntries(asHeader([entryWithBytes('tooLarge', 4097), 'control=ok']));
    assert.equal(rejected.has('tooLarge'), false);
    assert.equal(rejected.size, 1);
    assert.equal(rejected.get('control').value, 'ok');
  });

  test(`baggage ${shape}: enforces the shared 8192-byte budget including separators`, () => {
    const first = entryWithBytes('a', 4096);
    const second = entryWithBytes('b', 4095);
    assert.equal(Buffer.byteLength(`${first},${second}`, 'utf8'), 8192);
    const atLimit = baggageEntries(asHeader([first, second]));
    assert.equal(atLimit.size, 2);
    assert.equal(atLimit.get('a').value.length, 4094);
    assert.equal(atLimit.get('b').value.length, 4093);

    const aboveLimit = baggageEntries(asHeader([first, second, 'tail=x']));
    assert.equal(aboveLimit.size, 2);
    assert.equal(aboveLimit.has('tail'), false);
    assert.equal(aboveLimit.get('a').value.length, 4094);
    assert.equal(aboveLimit.get('b').value.length, 4093);

    const secondOneByteOver = entryWithBytes('b', 4096);
    assert.equal(Buffer.byteLength(`${first},${secondOneByteOver}`, 'utf8'), 8193);
    const oneByteOver = baggageEntries(asHeader([first, secondOneByteOver]));
    assert.equal(oneByteOver.size, 1);
    assert.equal(oneByteOver.get('a').value.length, 4094);
    assert.equal(oneByteOver.has('b'), false);
  });
}
