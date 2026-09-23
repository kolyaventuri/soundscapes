const config = [
	{
		ignores: ['**/dist/**', 'coverage/**', 'data/**', 'models/**'],
		rules: {
			// Permit external protocol keys such as PORT and HTTP status codes.
			'@typescript-eslint/naming-convention': ['error',
				{selector: 'variableLike', format: ['strictCamelCase', 'PascalCase', 'UPPER_CASE']},
				{selector: 'typeLike', format: ['PascalCase']}],
		},
	},
	{
		files: ['apps/web/src/**/*.{ts,tsx}'],
		react: true,
		rules: {
			// Vite uses React's automatic JSX runtime.
			'react/react-in-jsx-scope': 'off',
		},
	},
	{
		files: ['**/*.test.ts'],
		rules: {
			// Test tooling is owned by the workspace root.
			'import-x/no-extraneous-dependencies': ['error', {packageDir: ['.', 'apps/server', 'packages/shared'], devDependencies: true}],
			'n/no-extraneous-import': ['error', {allowModules: ['vitest']}],
		},
	},
];

export default config;
