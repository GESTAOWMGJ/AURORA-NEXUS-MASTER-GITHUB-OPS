# Model card — metadata classifier foundation

## Status

Engineering demonstrator only. No clinical validation or production activation.

## Input and output

Inputs are allowlisted metadata fields without document content. Outputs are a
category, confidence, reason codes and mandatory review marker at low confidence.

## Limitations

The classifier must not process clinical narratives, identify patients, generate
medical decisions or communicate with patients. Provider changes and outages must
result in abstention or safe failure. Future tests require frozen mocks,
versioned prompts and traceable fixtures.
