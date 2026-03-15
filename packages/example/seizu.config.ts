export default {
  title: 'Transfer Service - Formal Specification',
  contracts: [],
  verify: { contracts: [] },
  formalSpec: {
    entrypoints: ['src/spec/domain.spec.ts', 'src/spec/api.spec.ts'],
    artifactDir: '.seizu',
  },
};
