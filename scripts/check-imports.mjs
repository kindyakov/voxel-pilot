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
	for await (const filename of files(resolve(owner.directory, 'src'))) {
		const source = ts.createSourceFile(
			filename,
			await readFile(filename, 'utf8'),
			ts.ScriptTarget.Latest,
			true
		)
		const fail = message =>
			violations.push(`${relative(root, filename)}: ${message}`)
		const check = (specifier, typeOnly) => {
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
				return
			}
			const segments = specifier.split('/')
			const packageName = specifier.startsWith('@')
				? segments.slice(0, 2).join('/')
				: segments[0]
			if (!declared[packageName]) fail(`undeclared dependency: ${packageName}`)
			const workspace = owners.find(
				candidate => candidate.manifest.name === packageName
			)
			if (workspace) {
				if (owner.manifest.name === '@voxel-pilot/core')
					fail(`core depends on another runtime package: ${specifier}`)
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
