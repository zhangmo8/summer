import fs from 'fs'
import mine = require('mime')
import path = require('path')

import { getEnvConfig } from './config-handler'
import { ServerConfig } from './http-server'

interface StaticResult {
  code: number
  headers: any
  filePath?: string
}

export const handleStaticRequest = (requestPath: string): StaticResult | null => {
  const serverConfig: ServerConfig = getEnvConfig('SERVER_CONFIG')
  if (serverConfig.static) {
    for (const staticConfig of serverConfig.static) {
      let { requestPath: requestPathRoot, destPath: destPathRoot, indexFiles } = staticConfig
      requestPathRoot = requestPathRoot.replace(/\/$/, '')
      let requestFile = '.' + requestPath
      const targetPath = destPathRoot
      if (!path.resolve(requestFile).startsWith(path.resolve(requestPathRoot.replace(/^\//, '')))) {
        continue
      }

      if (requestPath.startsWith(requestPathRoot + '/') || requestPath === requestPathRoot) {
        requestFile = requestFile.replace(requestPathRoot.replace(/^\//, ''), targetPath)
        if (targetPath.startsWith('/')) {
          requestFile = requestFile.replace('./', '')
        }

        if (fs.existsSync(requestFile) && !fs.lstatSync(requestFile).isDirectory()) {
        } else if (fs.existsSync(requestFile) && fs.lstatSync(requestFile).isDirectory()) {
          if (!requestFile.endsWith('/')) {
            return {
              code: 301,
              headers: { Location: (serverConfig.basePath || '') + requestPath + '/', 'Cache-Control': 'no-store' }
            }
          } else if (indexFiles) {
            let foundFile = false
            for (const file of indexFiles) {
              if (fs.existsSync(requestFile + file)) {
                requestFile = requestFile + file
                foundFile = true
                break
              }
            }
            if (!foundFile) {
              requestFile = ''
            }
          }
        } else {
          requestFile = ''
        }

        // spa
        if (staticConfig.spa && !requestFile && path.extname(requestPath) === '') {
          let foundFile = false
          for (const file of indexFiles || []) {
            if (fs.existsSync(targetPath + '/' + file)) {
              requestFile = targetPath + '/' + file
              foundFile = true
              break
            }
          }
          if (!foundFile) {
            requestFile = ''
          }
        }

        if (requestFile) {
          const mineType = mine.getType(path.extname(requestFile).replace('.', ''))
          const headers = { 'Cache-Control': 'max-age=2592000' }
          if (mineType) {
            headers['Content-Type'] = mineType
          }
          return { code: 200, headers, filePath: requestFile }
        } else {
          return { code: 404, headers: {} }
        }
      }
    }
  }
  return null
}
