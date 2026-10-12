require('dotenv').config({ quiet: true })

const fs = require('node:fs/promises')
const path = require('node:path')
const { cloudinary } = require('../config/cloudinary')

const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`

async function main() {
  const videos = []
  let nextCursor

  do {
    const result = await cloudinary.api.resources({
      resource_type: 'video',
      type: 'upload',
      max_results: 500,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    })
    videos.push(...(result.resources || []))
    nextCursor = result.next_cursor
  } while (nextCursor)

  const rows = [
    ['public_id', 'asset_folder', 'secure_url', 'format', 'duration_seconds'],
    ...videos.map((video) => [video.public_id, video.asset_folder, video.secure_url, video.format, video.duration]),
  ]
  const csv = `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
  const output = path.join(__dirname, '..', 'videos-inventory.csv')
  await fs.writeFile(output, csv, 'utf8')
  console.log(`Listed ${videos.length} videos; saved inventory to ${path.basename(output)}.`)
}

main().catch((error) => {
  const status = error.http_code || error.statusCode
  console.error(`Could not list Cloudinary videos${status ? ` (HTTP ${status})` : ''}: ${error.message || error.name || 'unknown error'}`)
  process.exitCode = 1
})
