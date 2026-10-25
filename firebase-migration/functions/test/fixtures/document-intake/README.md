`password-synthetic.pdf` is a locally generated blank 100x100 point PDF, encrypted
with the public test-only password `synthetic-test-only`, using bundled pypdf6.10.0.
It contains no customer document, login credential or external content. The parser
is deliberately not given this password: the expected result is
`ENCRYPTED_DOCUMENT`, empty text and no extraction hash. pypdf is fixture-authoring
tooling only and is not a runtime dependency of Aurora.
