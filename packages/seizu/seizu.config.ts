export default {
  title: 'seizu Self-Verification',
  contracts: ['src/**/*.ts'],
  verify: { contracts: [] },
  formalSpec: {
    entrypoints: ['src/spec/seizu.spec.ts'],
    artifactDir: '.seizu',
  },
};
