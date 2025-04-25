import nodePath from 'node:path'
import {pipeline} from 'node:stream/promises'

import express from 'express'
import fse from 'fs-extra'

import type {ApiOptions} from '../server/index.js'

export default function api({publicApi, privateApi, umbreld}: ApiOptions) {
	// Serve thumbnails from the thumbnails directory
	// GET /api/files/thumbnail/:thumbnail
	privateApi.use(
		'/thumbnail',
		// Serve the thumbnail assets
		express.static(umbreld.files.thumbnails.thumbnailDirectory, {
			// Thumbnail assets are named with a hash that only changes when the file is modified
			// So we can cache these aggressively
			maxAge: '1 year',
			immutable: true,
			// Don't serve directory indexes
			index: false,
		}),
		// If we don't get a file hit, return a 404
		(request, response) => response.status(404).json({error: 'not found'}),
	)

	// Downloads a file, directory or multiple files
	// GET /api/files/download?path=/Home/file.txt&path=/Home/file-2.txt
	privateApi.get('/download', async (request, response) => {
		// Normalise a single path or multiple paths into an array
		let virtualPaths: string[] = []
		if (typeof request.query.path === 'string') virtualPaths = [String(request.query.path)]
		if (Array.isArray(request.query.path)) virtualPaths = request.query.path.map(String)

		// Check that at least one path is provided
		if (virtualPaths.length < 1) return response.status(400).json({error: 'bad request'})

		// Get file data
		const files = await Promise.all(
			virtualPaths.map(async (path) => {
				try {
					const systemPath = await umbreld.files.virtualToSystemPath(path)
					if (!(await fse.exists(systemPath))) throw new Error('not found')
					return systemPath
				} catch (error) {
					// This means a file doesn't exist (or can't be safely resolved) so we return a 404
					response.status(404).json({error: 'not found'})
					throw error
				}
			}),
		)

		// If we only have a single file, serve it directly
		if (files.length === 1 && (await fse.stat(files[0])).isFile()) {
			const filename = nodePath.basename(files[0])
			response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
			return response.sendFile(files[0])
		}

		// Create an archive and stream it to the response
		try {
			// For directory or multiple files, create zip archive
			const filename = umbreld.files.archive.zipName(files, {defaultName: 'umbrel-files.zip'})
			response.setHeader('Content-Type', 'application/zip')
			response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)

			const zipStream = await umbreld.files.archive.createZipStream(files)
			await pipeline(zipStream, response)
		} catch (error) {
			if ((error as Error).message === 'paths must be in same directory') {
				return response.status(400).json({error: (error as Error).message})
			}

			throw error
		}
	})

	// Views a file
	// GET /api/files/view?path=/Home/file.txt
	privateApi.get('/view', async (request, response) => {
		try {
			if (typeof request.query.path !== 'string') return response.status(400).json({error: 'path is required'})
			const systemPath = await umbreld.files.virtualToSystemPath(request.query.path)
			const status = await umbreld.files.status(systemPath)
			if (status.type === 'directory') return response.status(400).json({error: 'cannot view a directory'})
			response.sendFile(systemPath)
		} catch (error) {
			return response.status(404).json({error: 'not found'})
		}
	})

	// Uploads a file
	// POST /api/files/upload?path=/Home/file.txt&collision=error|keep-both|replace
	// Note: We must set the `Connection: close` header on error to prevent the XHR upload logic
	// from uploading the entire file before checking for errors in the response. cURL handles this
	// without the extra header, I'm not sure why it's only needed in the browser.
	privateApi.post('/upload', async (request, response) => {
		// Check we have a path
		if (typeof request.query.path !== 'string') {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'path is required'})
		}

		// Get the collision strategy
		const collision = typeof request.query.collision === 'string' ? request.query.collision : 'error'
		const isValidCollisionParameter = ['error', 'keep-both', 'replace'].includes(collision)
		if (!isValidCollisionParameter) {
			response.setHeader('Connection', 'close')
			return response.status(400).json({error: 'invalid collision parameter'})
		}

		// Check path is valid
		let systemPath = await umbreld.files.virtualToSystemPath(request.query.path).catch((error) => {
			response.setHeader('Connection', 'close')
			response.status(400).json({error: 'invalid path'})
			throw error
		})

		// Handle name conflicts
		// TODO: Implement resume support
		const exists = await fse.pathExists(systemPath)
		if (exists) {
			if (collision === 'error') {
				response.setHeader('Connection', 'close')
				return response.status(400).json({error: '[destination-already-exists]'})
				// For 'keep-both' we generate a unique name for the file
			} else if (collision === 'keep-both') systemPath = await umbreld.files.getUniqueName(systemPath)
			// For 'replace' we simply continue with the upload over the original file
		}

		// TODO: Check available disk space
		// We need the frontend to provide the total size of the file

		// Temporary file to store the uploaded data
		// We do this to avoid ending up with partially uploaded files of the correct name.
		// It's clear that a partially uploaded file with the .umbrel-upload suffix is not a
		// completed upload.
		// It also sets the groundwork for resuming uploads in the future.
		// It also means that fs change events during upload are fired for
		// .somefile.jpg.umbrel-upload not somefile.jpg so we don't trigger loads of
		// thumbnail generation attempts (matching the .jpg suffix) until the file is fully uploaded.
		// Using a dotfile also automatically hides these temporary files from most file listings
		const fileName = nodePath.basename(systemPath)
		const directory = nodePath.dirname(systemPath)
		const temporarySystemPath = nodePath.join(directory, `.${fileName}.umbrel-upload`)

		// Ensure containing directories exist
		await fse.ensureDir(nodePath.dirname(temporarySystemPath))

		// Write the file
		await pipeline(request, fse.createWriteStream(temporarySystemPath)).catch(async (error) => {
			// Clean up the temporary file
			await fse.remove(temporarySystemPath).catch(() => {})

			// Return an error
			response.setHeader('Connection', 'close')
			response.status(500).json({error: 'error writing file'})
			throw error
		})

		// Rename the temporary file to the final path
		await fse.rename(temporarySystemPath, systemPath)

		// Return success
		return response.status(200).json({path: umbreld.files.systemToVirtualPath(systemPath)})
	})
}
