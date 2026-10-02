import { readFile, readdir } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')))
const owners = []
for (const folder of ['packages', 'apps']) {
	for (const entry of await readdir(resolve(root, folder), {
		withFileTypes: true
	})) {
		if (!entry.isDirectory()) continue
		const directory = resolve(root, folder, entry.name)
		owners.push({
			directory,
			manifest: JSON.parse(
				await readFile(resolve(directory, 'package.json'), 'utf8')
			)
		})
	}
}
async function* files(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const filename = resolve(directory, entry.name)
		if (entry.isDirectory()) yield* files(filename)
		else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) yield filename
	}
}
const violations = []
for (const owner of owners) {
	const declared = {
		...owner.manifest.dependencies,
		...owner.manifest.devDependencies
	}
	const core = owner.manifest.name === '@voxel-pilot/core'
	const contracts = owner.manifest.name === '@voxel-pilot/contracts'
	const presentation = owner.manifest.name === '@voxel-pilot/presentation'
	const tui = owner.manifest.name === '@voxel-pilot/tui'
	const cli = owner.manifest.name === '@voxel-pilot/cli'
	if (contracts) {
		for (const name of Object.keys(owner.manifest.dependencies ?? {})) {
			violations.push(
				`packages/contracts/package.json: contracts must be independent: ${name}`
			)
		}
		for (const name of [
			'@types/node',
			'react',
			'ink',
			'xstate',
			'mineflayer'
		]) {
			if (declared[name])
				violations.push(
					`packages/contracts/package.json: nonportable contracts dependency: ${name}`
				)
		}
	}
	if (core) {
		for (const packageName of ['dotenv', 'ink', 'react', 'react-dom']) {
			if (declared[packageName])
				violations.push(
					`packages/core/package.json: app-owned dependency in core: ${packageName}`
				)
		}
	}
	if (presentation) {
		for (const name of Object.keys(owner.manifest.dependencies ?? {})) {
			if (name !== '@voxel-pilot/contracts')
				violations.push(
					`packages/presentation/package.json: presentation depends only on contracts: ${name}`
				)
		}
		for (const name of [
			'@types/node',
			'react',
			'ink',
			'xstate',
			'mineflayer'
		]) {
			if (declared[name])
				violations.push(
					`packages/presentation/package.json: nonportable presentation dependency: ${name}`
				)
		}
	}
	for await (const filename of files(resolve(owner.directory, 'src'))) {
		const source = ts.createSourceFile(
			filename,
			await readFile(filename, 'utf8'),
			ts.ScriptTarget.Latest,
			true
		)
		const fail = message =>
			violations.push(`${relative(root, filename)}: ${message}`)
		const productionCore = core && !filename.includes(`${sep}tests${sep}`)
		const productionTui = tui && !filename.includes(`${sep}tests${sep}`)
		const local = relative(resolve(owner.directory, 'src'), filename).split(sep)
		const check = (specifier, typeOnly) => {
			if (contracts && !specifier.startsWith('.')) {
				fail(`contracts must use portable local types: ${specifier}`)
			}
			if (
				presentation &&
				!specifier.startsWith('.') &&
				specifier !== '@voxel-pilot/contracts'
			) {
				fail(
					`presentation must remain portable and use only contracts: ${specifier}`
				)
			}
			if (
				core &&
				/(?:config\/(?:config|logger)|core\/hsm|ai\/legacyAgentTurn)(?:\.[cm]?[jt]s)?$/.test(
					specifier
				)
			) {
				fail(`removed singleton entry: ${specifier}`)
			}
			if (builtins.has(specifier.replace(/^node:/, ''))) return
			if (specifier.startsWith('@/')) {
				if (owner.manifest.name !== '@voxel-pilot/core')
					fail(`core alias outside core: ${specifier}`)
				return
			}
			if (specifier.startsWith('.')) {
				const target = resolve(dirname(filename), specifier)
				if (!target.startsWith(owner.directory + sep))
					fail(`relative import crosses package boundary: ${specifier}`)
				if (productionTui) {
					const destination = relative(
						resolve(owner.directory, 'src'),
						target
					).split(sep)
					if (
						local[0] !== 'app' &&
						local[0] !== 'index.ts' &&
						(destination[0] === 'app' ||
							/^index(?:\.[cm]?[jt]sx?)?$/.test(destination[0]))
					)
						fail(`TUI reusable module imports composition: ${specifier}`)
					if (
						local[0] === 'ui' &&
						['features', 'runtime', 'terminal'].includes(destination[0])
					)
						fail(
							`independent TUI UI imports integration or feature: ${specifier}`
						)
					if (
						local[0] === 'runtime' &&
						['features', 'terminal', 'ui'].includes(destination[0])
					)
						fail(`TUI runtime bridge imports display: ${specifier}`)
					if (
						local[0] === 'terminal' &&
						['features', 'runtime'].includes(destination[0])
					)
						fail(`TUI terminal imports runtime or feature: ${specifier}`)
					if (
						local[0] === 'features' &&
						destination[0] === 'features' &&
						local[1] !== destination[1] &&
						!/^index\.[cm]?[jt]sx?$/.test(destination.slice(2).join('/'))
					)
						fail(`TUI sibling feature requires public index: ${specifier}`)
				}
				return
			}
			const segments = specifier.split('/')
			const packageName = specifier.startsWith('@')
				? segments.slice(0, 2).join('/')
				: segments[0]
			if (!declared[packageName]) fail(`undeclared dependency: ${packageName}`)
			if (
				productionTui &&
				local[0] !== 'app' &&
				['@voxel-pilot/core', '@voxel-pilot/application'].includes(packageName)
			)
				fail(
					`TUI executable runtime dependency outside composition: ${specifier}`
				)
			if (
				cli &&
				!filename.includes(`${sep}tests${sep}`) &&
				packageName === '@voxel-pilot/application' &&
				!['bootstrap.ts', 'settings.ts'].includes(local.join('/'))
			)
				fail(`CLI application dependency outside composition: ${specifier}`)
			const workspace = owners.find(
				candidate => candidate.manifest.name === packageName
			)
			if (workspace) {
				if (
					owner.directory.startsWith(resolve(root, 'packages') + sep) &&
					workspace.directory.startsWith(resolve(root, 'apps') + sep)
				)
					fail(`library workspace imports application: ${specifier}`)
				if (core && workspace.manifest.name !== '@voxel-pilot/contracts')
					fail(
						`core workspace dependency must be portable contracts: ${specifier}`
					)
				const subpath =
					specifier === packageName
						? '.'
						: '.' + specifier.slice(packageName.length)
				if (!Object.hasOwn(workspace.manifest.exports ?? {}, subpath))
					fail(`private workspace import: ${specifier}`)
				if (!declared[packageName]?.startsWith('workspace:'))
					fail(`workspace protocol required: ${packageName}`)
			}
			if (
				!typeOnly &&
				!filename.includes(`${sep}tests${sep}`) &&
				!owner.manifest.dependencies?.[packageName]
			) {
				fail(`runtime dependency declared only for development: ${packageName}`)
			}
		}
		const visit = node => {
			if (
				presentation &&
				ts.isIdentifier(node) &&
				['process', 'Buffer', 'require', '__dirname', '__filename'].includes(
					node.text
				)
			) {
				fail(`presentation uses Node global: ${node.text}`)
			}
			if (
				(productionCore ||
					(productionTui && local[0] !== 'app' && local[0] !== 'index.ts')) &&
				ts.isPropertyAccessExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === 'process' &&
				node.name.text === 'env'
			) {
				fail(
					core
						? 'core reads process.env instead of an explicit settings snapshot'
						: 'TUI reusable module reads process.env'
				)
			}
			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier)
			) {
				const clause = ts.isImportDeclaration(node)
					? node.importClause
					: undefined
				const named = clause?.namedBindings
				const typeOnly = Boolean(
					node.isTypeOnly ||
					clause?.isTypeOnly ||
					(!clause?.name &&
						named &&
						ts.isNamedImports(named) &&
						named.elements.every(item => item.isTypeOnly))
				)
				check(node.moduleSpecifier.text, typeOnly)
			}
			if (
				ts.isCallExpression(node) &&
				node.arguments[0] &&
				ts.isStringLiteral(node.arguments[0]) &&
				(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
					(ts.isIdentifier(node.expression) &&
						node.expression.text === 'require'))
			)
				check(node.arguments[0].text, false)
			ts.forEachChild(node, visit)
		}
		visit(source)
	}
}
if (violations.length) throw new Error(violations.join('\n'))
console.log(
	`Import boundaries and direct dependencies checked for ${owners.length} workspaces.`
)
