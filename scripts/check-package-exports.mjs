#!/usr/bin/env node

const paths = [
  "alchemy-render",
  "alchemy-render/Api",
  "alchemy-render/Actions",
  "alchemy-render/Account",
  "alchemy-render/Datastores",
  "alchemy-render/EnvironmentGroups",
  "alchemy-render/Projects",
  "alchemy-render/Services",
  "alchemy-render/ServiceConfiguration",
];

await Promise.all(paths.map((path) => import(path)));
console.log(`package export smoke test OK: ${paths.length} entry points`);
