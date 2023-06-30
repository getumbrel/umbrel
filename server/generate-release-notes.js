#!/usr/bin/env node
import {$} from 'execa'
import fse from 'fs-extra'
import got from 'got'

const githubUsernames = {
  'Luke Childs <lukechilds123@gmail.com>': '@lukechilds',
  'Nathan Fretz <nmfretz@gmail.com>': '@nmfretz',
  'Mayank Chhabra <mayankchhabra9@gmail.com>': '@mayankchhabra',
}

async function lookupUsername(author) {
  // If the username starts with @ we probably already have a GitHub username
  if (author.startsWith('@')) return author.split(' ')[0]

  // If we already havfe the username cached, return it
  if (githubUsernames[author]) return githubUsernames[author]

  // Attempt to lookup the GitHub username from the commit details
  try {
    console.log(`Looking up ${author}`)
    const data = await got(`https://api.github.com/search/users?q=${author}`, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`
      },
    }).json()
    const username = data?.items?.[0]?.login

    if (username) {
      // Cache for next time
      githubUsernames[author] = `@${username}`
      return githubUsernames[author]
    }
  } catch (error) {
    console.log(error.message)
    // If anything goes wrong just fall back to commit credentials
  }

  // If we didn't find anything, cache the original commit details to save additional failing lookups
  // Also log the failure to help us find it so we can manually update
  githubUsernames[author] = author
  console.log('Failed')

  // Return the original commit details if we didn't find anything
  return author
}

async function main() {
  let range = process.argv[2]

  if (!range) {
    const gitTag = await $`git tag --sort=-creatordate`
    const tags = gitTag.stdout.split('\n')
    range = `${tags[1]}...${tags[0]}`
  }

  const markdown = []
  markdown.push('## Changes')
  markdown.push('')
  markdown.push(`https://github.com/getumbrel/umbrel/compare/${range}`)
  markdown.push('')

  const format = '===COMMIT_DELIMITER===%n%h%n%s%n%an <%ae>%n%b'
  const log = await $`git log --pretty=format:${format} ${range}`
  const commits = log.stdout.split('===COMMIT_DELIMITER===\n')
  for (const commit of commits) {
    const [hash, title, author, ...body] = commit.split('\n')
    if (!hash) continue

    const coAuthors = body
      .filter(line => line.startsWith('Co-authored-by:'))
      .map(line => line.replace('Co-authored-by: ', '').trim())
    const authors = []
    for (const person of [author, ...coAuthors]) {
      authors.push(await lookupUsername(person))
    }

    markdown.push(`- ${title} (${hash}) ${authors.join(' ')}`)
  }
  
  console.log('')
  console.log(markdown.join('\n'))
  await fse.writeFile('release-notes.md', markdown.join('\n'))
  
}

await main()