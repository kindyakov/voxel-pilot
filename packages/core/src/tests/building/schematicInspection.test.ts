import assert from 'node:assert/strict'
import test from 'node:test'

import {
	decodePaletteIndices,
	summarizeSimplifiedSchematic
} from '../../building/schematicInspection.js'

test('decodePaletteIndices decodes Sponge varint block data', () => {
	assert.deepEqual(decodePaletteIndices([0x00, 0x01, 0xac, 0x02]), [0, 1, 300])
})

test('summarizeSimplifiedSchematic extracts palette counts and sample blocks', () => {
	const summary = summarizeSimplifiedSchematic({
		Version: 3,
		DataVersion: 3465,
		Width: 2,
		Height: 1,
		Length: 2,
		Offset: [0, 0, 0],
		PaletteMax: 2,
		Palette: {
			'minecraft:stone': 0,
			'minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]':
				1
		},
		BlockData: [0, 1, 1, 0],
		BlockEntities: []
	})

	assert.equal(summary.version, 3)
	assert.equal(summary.dataVersion, 3465)
	assert.deepEqual(summary.dimensions, { width: 2, height: 1, length: 2 })
	assert.equal(summary.paletteSize, 2)
	assert.equal(summary.totalBlocks, 4)
	assert.equal(summary.filledBlocks, 4)
	assert.equal(summary.blockEntitiesCount, 0)
	assert.deepEqual(summary.offset, [0, 0, 0])

	assert.deepEqual(summary.topPaletteEntries, [
		{ state: 'minecraft:stone', paletteIndex: 0, count: 2 },
		{
			state:
				'minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]',
			paletteIndex: 1,
			count: 2
		}
	])

	assert.deepEqual(summary.sampleBlocks, [
		{ x: 0, y: 0, z: 0, paletteIndex: 0, state: 'minecraft:stone' },
		{
			x: 1,
			y: 0,
			z: 0,
			paletteIndex: 1,
			state:
				'minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]'
		},
		{
			x: 0,
			y: 0,
			z: 1,
			paletteIndex: 1,
			state:
				'minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]'
		},
		{ x: 1, y: 0, z: 1, paletteIndex: 0, state: 'minecraft:stone' }
	])
})
