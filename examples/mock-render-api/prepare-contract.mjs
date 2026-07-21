import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const templateURL = new URL('./contract.json', import.meta.url)
const outputURL = new URL('./contract.ready.json', import.meta.url)
const template = await readFile(templateURL, 'utf8')
const output = `${JSON.stringify(JSON.parse(template), null, 2)}\n`
await writeFile(outputURL, output, 'utf8')
console.log(`Prepared UID-free contract at ${fileURLToPath(outputURL)}`)
