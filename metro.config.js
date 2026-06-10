// Metro config (CJS — package.json has no "type": "module").
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The game-logic library in src/ uses Node-style relative imports with `.js`
// extensions (e.g. `./types.js`) that point at `.ts` sources. Metro doesn't
// apply TypeScript's extension substitution, so rewrite those specifiers to be
// extensionless and let Metro's normal source-extension resolution find the
// `.ts` file.
const defaultResolveRequest = config.resolver.resolveRequest;
const srcDir = path.join(__dirname, 'src');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  let rewritten = moduleName;
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath.startsWith(srcDir + path.sep)
  ) {
    rewritten = moduleName.slice(0, -'.js'.length);
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, rewritten, platform);
  }
  return context.resolveRequest(context, rewritten, platform);
};

module.exports = config;
