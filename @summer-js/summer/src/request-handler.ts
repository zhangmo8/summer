import { AsyncLocalStorage } from 'node:async_hooks'
import { Readable } from 'node:stream'
import fs from 'fs'
import mine from 'mime'
import { basename, extname } from 'path'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { getEnvConfig } from './config-handler'
import { getInjectable, iocContainer } from './ioc'
import { Logger } from './logger'
import { middlewares } from './middleware'
import { requestMapping } from './request-mapping'
import { validateAndConvertType } from './validate-types'
import { session } from './session'
import { parseCookie, assembleCookie } from './cookie'
import { handleCors } from './cors'
import { rpc } from './rpc'
import { OtherErrors, NotFoundError, ResponseError, ValidationError } from './error'
import { errorHandle } from './error'
import { ServerConfig } from './http-server'

const zip = promisify(gzip)

interface RequestContext {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'
  path: string
  pathParams: Record<string, string | undefined>
  queries: Record<string, string | undefined>
  headers: Record<string, string | undefined>
  body?: string
}

export class StreamingData {
  readable: Readable
  contentType: string
  downloadFileName: string

  constructor(
    filePathOrReadStream: string | Readable,
    options: { contentType?: string; downloadFileName?: string } = {}
  ) {
    if (typeof filePathOrReadStream === 'string') {
      this.readable = fs.createReadStream(filePathOrReadStream)
    } else {
      this.readable = filePathOrReadStream
    }
    const { contentType, downloadFileName } = options
    if (contentType) {
      this.contentType = contentType
    }
    if (downloadFileName) {
      this.downloadFileName = downloadFileName
    }
  }
}

export interface ResponseContext {
  statusCode: number
  headers: Record<string, string | string[]>
  body: any
}

export interface Context {
  request: RequestContext
  response: ResponseContext
  cookies?: Record<string, string>
  data: Record<string, any>
  invocation?: {
    className: string
    methodName: string
    params: any[]
  }
}

export const asyncLocalStorage = new AsyncLocalStorage<Context>()

export const matchPathMethod = (path: string, httpMethod: string) => {
  let routeData = requestMapping[path]

  // 直接匹配
  if (routeData) {
    const methodData = routeData[httpMethod] || routeData['REQUEST']
    if (methodData) {
      return {
        controller: iocContainer.getInstance(methodData.controllerClass),
        ...methodData
      }
    }
  }
  // 正则匹配
  else {
    const paths = Object.keys(requestMapping)
    for (let i = 0; i < paths.length; i++) {
      routeData = requestMapping[paths[i]]
      const methodData = routeData[httpMethod] || routeData['REQUEST']
      if (methodData) {
        const pathParamArray = routeData.pathRegExp.exec(path)
        if (pathParamArray) {
          const pathKeys = routeData.pathKeys
          const pathParams = {}
          pathKeys.forEach((pk, inx) => {
            pathParams[pk] = decodeURIComponent(pathParamArray[inx + 1])
          })
          return {
            controller: iocContainer.getInstance(methodData.controllerClass),
            pathParams,
            ...methodData
          }
        }
      }
    }
  }
  return null
}
const serialize = (obj, declareType: any[]) => {
  let [d0, , d2] = declareType || []
  if (typeof d0 === 'function' && d0.name === '') {
    d0 = d0()
  }

  if (typeof obj !== 'object') {
    if (typeof d0 === 'object' && !Array.isArray(d0)) {
      if (d0[obj] && typeof obj === 'number') {
        obj = d0[obj]
      } else if (typeof d0[obj] !== 'number') {
        for (const enumKey in d0) {
          if (d0[enumKey] === obj) {
            obj = enumKey
          }
        }
      }
    }
  } else if (Array.isArray(obj)) {
    obj = (obj || []).map((item) => serialize(item, [d0, undefined, d2]))
  } else {
    const t = { ...obj }
    for (const key in obj) {
      let declareType =
        Reflect.getMetadata('DeclareType', obj, key) ||
        (d0 ? Reflect.getMetadata('DeclareType', d0.prototype, key) : []) ||
        []
      if (typeof declareType[0] === 'number') {
        if (d2) {
          const d1Type = declareType[1]
          declareType = d2[declareType[0]] || []
          if (d1Type) {
            declareType[1] = d1Type
          }
        } else {
          declareType = []
        }
      }
      if (declareType[2]) {
        declareType[2].forEach((d, inx) => {
          if (typeof d[0] === 'number') {
            declareType[2][inx] = d2[d[0]]
          }
        })
      }
      const serializeFunc = Reflect.getMetadata('Serialize', obj, key)
      if (!serializeFunc) {
        obj[key] = serialize(obj[key], declareType)
      } else {
        obj[key] = serializeFunc(obj[key], t)
      }
    }
  }

  return obj
}

export const applyResponse = (ctx: Context, responseData: any, returnDeclareType: any[]) => {
  if (responseData === undefined) {
    responseData = ''
  }
  const isJSON = typeof responseData === 'object'
  if (isJSON) {
    responseData = serialize(responseData, returnDeclareType)
  }

  if (ctx.response.body === undefined) {
    ctx.response.body = isJSON ? JSON.stringify(responseData) : responseData + ''
  }

  ctx.response.statusCode = ctx.response.statusCode || 200
  ctx.response.headers['Content-Type'] =
    ctx.response.headers['Content-Type'] || (isJSON ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8')
}

export const checkValidationError = (originalFunc, context) => {
  if (originalFunc.name) {
    const validateErrors = context.$_ValidateErrors
    if (validateErrors) {
      delete context.$_ValidateErrors
      throw new ValidationError(400, { message: 'Validation Failed', errors: validateErrors })
    }
  }
}

const callControllerMethod = async (ctx: Context) => {
  const { method, path } = ctx.request
  const match = matchPathMethod(path, method)
  if (match !== null) {
    const { controller, callMethod, params, pathParams } = match
    ctx.request.pathParams = pathParams
    ctx.invocation = {
      className: controller.constructor.name,
      methodName: callMethod,
      params: []
    }
    const applyParam: any[] = []
    let allErrors = []
    for (let i = 0; i < params.length; i++) {
      const param = params[i]
      if (param) {
        let paramValue = param.paramMethod(ctx, ...param.paramValues)
        const convertedValue = await validateAndConvertType(
          param.declareType,
          param.paramValues[0],
          paramValue,
          allErrors,
          callMethod,
          param.index,
          controller
        )
        applyParam.push(convertedValue)
      } else {
        applyParam.push(undefined)
      }
    }

    if (allErrors.length > 0) {
      ;(ctx as any).$_ValidateErrors = allErrors
      checkValidationError(controller[callMethod], ctx)
    }
    let responseData = await controller[callMethod].apply(controller, applyParam)
    if (!(responseData instanceof StreamingData)) {
      const returnDeclareType = Reflect.getMetadata('ReturnDeclareType', controller, callMethod)
      applyResponse(ctx, responseData, returnDeclareType)
    } else {
      ctx.response.body = responseData
      ctx.response.statusCode = 200
    }
  } else {
    throw new NotFoundError(404, { message: 'Api Not Found' })
  }
}

const callMiddleware = async (ctx: Context, deep = 0) => {
  const mw = middlewares[deep]
  const next = async () => await callMiddleware(ctx, deep + 1)
  if (mw) {
    await mw.process(ctx, next)
  } else {
    await callControllerMethod(ctx)
  }
}

const handleRpc = async (ctx: Context) => {
  if (ctx.request.headers['summer-rpc-access-key']) {
    if (
      getEnvConfig('RPC_CONFIG').provider &&
      ctx.request.headers['summer-rpc-access-key'] === getEnvConfig('RPC_CONFIG').provider.accessKey
    ) {
      let rpcData
      try {
        rpcData = JSON.parse(ctx.request.body!)
        if (!rpcData.class || !rpcData.method) {
          throw new Error()
        }
      } catch (e) {
        Logger.error('Error parsing rpc data')
      }

      if (rpcData) {
        try {
          const result = await rpc.call(rpcData.class, rpcData.method, rpcData.data || [])
          ctx.response.statusCode = 200
          ctx.response.body = JSON.stringify(result)
        } catch (e) {
          Logger.error(e)
          ctx.response.statusCode = 400
          ctx.response.body = JSON.stringify({ error: e.message })
        }
      }
    } else {
      const msg = 'Rpc accessKey mismatch'
      Logger.error(msg)
      ctx.response.statusCode = 400
      ctx.response.body = JSON.stringify({ error: msg })
    }
    return true
  }
  return false
}

const makeServerError = (ctx: Context) => {
  ctx.response.statusCode = ctx.response.statusCode || 500
  ctx.response.headers['Content-Type'] = ctx.response.headers['Content-Type'] || 'text/html; charset=utf-8'
  if (ctx.response.body === undefined) {
    ctx.response.body = 'Server Error'
  }
}

const makeRequestError = (ctx: Context, responseError: ResponseError) => {
  ctx.response.statusCode = responseError.statusCode
  delete ctx.response.headers['Content-Type']
  ctx.response.body = responseError.body
}

const decodeQuery = (ctx: Context) => {
  Object.keys(ctx.request.queries).forEach((key) => {
    if (ctx.request.queries[key] !== '') {
      ctx.request.queries[key] = decodeURIComponent(ctx.request.queries[key]!)
    } else {
      delete ctx.request.queries[key]
    }
  })
}

const patchRequestHeader = (ctx: Context, lCaseHeaders?: Record<string, string>) => {
  // header case-insensitive
  let lowerCaseHeader = lCaseHeaders
  if (!lowerCaseHeader) {
    lowerCaseHeader = {}
    Object.keys(ctx.request.headers || {}).forEach((key) => {
      lowerCaseHeader![key.toLocaleLowerCase()] = ctx.request.headers[key]!
    })
  }
  ctx.request.headers = new Proxy(ctx.request.headers as any, {
    get(_target, key: string) {
      return lowerCaseHeader![key.toLocaleLowerCase()]
    },
    set(_) {
      return false
    }
  })
}

export const requestHandler = async (ctx: Context, lowerCaseHeaders?: Record<string, string>) => {
  await asyncLocalStorage.run(ctx, async () => {
    try {
      patchRequestHeader(ctx, lowerCaseHeaders)
      decodeQuery(ctx)
      if (ctx.request.body === '') {
        delete ctx.request.body
      }
      if (await handleRpc(ctx)) {
        return
      }

      if (handleCors(ctx)) {
        return
      }

      parseCookie(ctx)
      await session.handleSession(ctx)
      await callMiddleware(ctx)
      assembleCookie(ctx)
    } catch (err) {
      const { errorHandlerClass, errorMap } = errorHandle
      if (errorHandlerClass) {
        const errorHandler = getInjectable(errorHandlerClass)!
        const errType = errorMap.find((e) => err instanceof e.type)
        if (errType) {
          const errInfo = errorHandler[errType.method](err)
          err = new ResponseError(errInfo.statusCode, errInfo.body)
        } else {
          const otherErrorsType = errorMap.find((e) => e.type === OtherErrors)
          if (otherErrorsType) {
            const errInfo = errorHandler[otherErrorsType.method](err)
            err = new ResponseError(errInfo.statusCode, errInfo.body)
          }
        }
      }
      if (err instanceof ResponseError || err instanceof ValidationError || err instanceof NotFoundError) {
        makeRequestError(ctx, err)
      } else {
        Logger.error(err)
        makeServerError(ctx)
      }
    }

    const body = ctx.response.body
    if (typeof body !== 'string') {
      if (body !== undefined) {
        if (!(body instanceof StreamingData)) {
          ctx.response.headers['Content-Type'] =
            ctx.response.headers['Content-Type'] || 'application/json; charset=utf-8'
          ctx.response.body = JSON.stringify(body)
        } else {
          let downloadFileName
          let mimeFileName
          let mimeType
          if (body.downloadFileName) {
            downloadFileName = basename(body.downloadFileName)
            mimeFileName = body.downloadFileName
          } else if (body.readable instanceof fs.ReadStream) {
            mimeFileName = body.readable.path
          }

          if (mimeFileName) {
            const ext = extname(mimeFileName).replace('.', '')
            if (ext) {
              mimeType = mine.getType(ext)
            }
          }

          if (downloadFileName) {
            ctx.response.headers['Content-Disposition'] = `attachment; filename="${downloadFileName}"`
          }
          const contentType = body.contentType ?? mimeType ?? 'application/octet-stream'
          ctx.response.headers['Content-Type'] = ctx.response.headers['Content-Type'] || contentType
        }
      } else {
        ctx.response.body = ''
      }
    } else {
      ctx.response.headers['Content-Type'] = ctx.response.headers['Content-Type'] || 'text/html; charset=utf-8'
    }

    if (ctx.response.statusCode === 0) {
      if (ctx.response.body === undefined) {
        Logger.error('Unhandled request response, this error may cause by middleware missing await for next()')
      }
      makeServerError(ctx)
    }

    // compression
    const serverConfig = getEnvConfig('SERVER_CONFIG') as ServerConfig
    if (serverConfig.compression && serverConfig.compression.enable) {
      const contentType = ctx.response.headers['Content-Type']
      if (
        !ctx.response.headers['Content-Encoding'] &&
        (contentType.includes('application/json') || contentType.includes('text/html'))
      ) {
        if (ctx.response.body.length > (serverConfig.compression.threshold ?? 860)) {
          ctx.response.body = await zip(ctx.response.body)
          ctx.response.headers['Content-Encoding'] = 'gzip'
        }
      }
    }
  })
}

export const getContext = () => asyncLocalStorage.getStore()
