import { describe, expect, it } from 'vitest'
import { parseNunitTestCases } from './unity-nunit-results'

describe('parseNunitTestCases', () => {
  it('reads CDATA and entity-escaped failure text, self-closing cases and ignored labels', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<test-run>
  <test-suite type="TestFixture" name="Fixture">
    <test-case id="1" name="Passes" fullname="Ns.Fixture.Passes" result="Passed" duration="0.0123" />
    <test-case id="2" name="Fails(1,&quot;a&quot;)" fullname="Ns.Fixture.Fails(1,&quot;a&quot;)" result="Failed" label="Error" duration="0.5">
      <failure>
        <message><![CDATA[Expected: <1> & got 2]]></message>
        <stack-trace>at Ns.Fixture.Fails () in C:\\p\\Assets\\T.cs:12 &amp; more</stack-trace>
      </failure>
      <output><![CDATA[log line]]></output>
    </test-case>
    <test-case id="3" name="Later" fullname="Ns.Fixture.Later" result="Skipped" label="Ignored" duration="0">
      <reason><message><![CDATA[not yet]]></message></reason>
    </test-case>
  </test-suite>
</test-run>`
    expect(parseNunitTestCases(xml)).toEqual([
      { fullName: 'Ns.Fixture.Passes', name: 'Passes', result: 'passed', durationSeconds: 0.0123 },
      {
        fullName: 'Ns.Fixture.Fails(1,"a")',
        name: 'Fails(1,"a")',
        result: 'failed',
        durationSeconds: 0.5,
        message: 'Expected: <1> & got 2',
        stackTrace: 'at Ns.Fixture.Fails () in C:\\p\\Assets\\T.cs:12 & more'
      },
      {
        fullName: 'Ns.Fixture.Later',
        name: 'Later',
        result: 'skipped',
        durationSeconds: 0,
        message: 'not yet'
      }
    ])
  })
})
