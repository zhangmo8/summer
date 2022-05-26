#!/usr/bin/env node

// @ts-check
const fs = require('fs')
const path = require('path')
const prompts = require('prompts')

var copyRecursiveSync = function (src, dest) {
  var exists = fs.existsSync(src)
  var stats = exists && fs.statSync(src)
  var isDirectory = exists && stats.isDirectory()
  if (isDirectory) {
    fs.mkdirSync(dest)
    fs.readdirSync(src).forEach(function (childItemName) {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName))
    })
  } else {
    fs.copyFileSync(src, dest)
  }
}

;(async () => {
  const response = await prompts({
    type: 'text',
    name: 'value',
    message: 'Project Name:',
    validate: (value) => (!value ? 'Please enter a name' : true)
  })

  const projectName = response.value
  if (!projectName) {
    return
  }

  if (fs.existsSync(projectName)) {
    console.log(projectName + ' exists, exit')
    return
  }

  copyRecursiveSync(path.join(__dirname, 'template'), projectName)

  fs.writeFileSync(
    projectName + '/.gitignore',
    ['.DS_Store', 'node_modules', 'build', 'compile', 'auto-imports.ts'].join('\n')
  )
  const packageJson = JSON.parse(fs.readFileSync(projectName + '/package.json', { encoding: 'utf8' }))
  packageJson.name = projectName
  fs.writeFileSync(projectName + '/package.json', JSON.stringify(packageJson, null, 4))

  console.log('Project Created! Now run:')
  console.log('')
  console.log(`$ cd ${projectName}`)
  console.log(`$ npm install`)
  console.log(`$ npm run dev`)
  console.log('')
})()
