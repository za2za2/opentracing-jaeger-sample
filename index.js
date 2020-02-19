const initTracer = require('jaeger-client').initTracer
const opentracing = require('opentracing')
const axios = require('axios')

const config = {
  serviceName: 'my-service',
}

const options = {}

const tracer = initTracer(config, options)

const express = require('express')
const app = express()

app.use((req, res, next) => {

  const wireContext = tracer.extract(opentracing.FORMAT_HTTP_HEADERS, req.headers)
  const rootSpan = tracer.startSpan(req.url, {childOf: wireContext})

  rootSpan.setTag(opentracing.Tags.HTTP_METHOD, req.method)
  rootSpan.setTag(opentracing.Tags.HTTP_URL, req.url)
  rootSpan.setTag(opentracing.Tags.SPAN_KIND, opentracing.Tags.SPAN_KIND_RPC_SERVER)

  req.rootSpan = rootSpan
  req.tracer = tracer
  
  const finishHandler = () => {
    rootSpan.setTag(opentracing.Tags.HTTP_STATUS_CODE, res.statusCode)
    rootSpan.finish()
  }

  res.on('end', finishHandler)
  res.on('finish', finishHandler)
  next()
})

app.use((req, res, next) => {
  const instance = (options) => {
    const instance = axios.create(options)
    instance.interceptors.request.use(config => {
      const childSpan = req.tracer.startSpan(`call ${req.originalUrl}`, {childOf: req.rootSpan.context()})
      
      childSpan.setTag(opentracing.Tags.HTTP_METHOD, config.method)
      childSpan.setTag(opentracing.Tags.HTTP_URL, `${config.baseURL}${config.url}`)
      childSpan.setTag(opentracing.Tags.SPAN_KIND, opentracing.Tags.SPAN_KIND_RPC_CLIENT)

      config.span = childSpan

      const carrier = {}
      req.tracer.inject(childSpan, opentracing.FORMAT_HTTP_HEADERS, carrier)
      Object.assign(config.headers, carrier)
      return config
    })
    instance.interceptors.response.use(response => {
      if (response.config && response.config.span) {
        const {span} = response.config
        span.setTag(opentracing.Tags.HTTP_STATUS_CODE, response.status)
        span.finish()
      }
      return response
    })
    return instance
  }
  req.axios = {
    instance
  }
  next()
})

app.get('/call', async (req, res) => {
  const instance = req.axios.instance({
    baseURL: 'http://127.0.0.1:8080',
  })
  const resp = await instance.get('/hoge')
  res.status(200).send()
})

app.get('*', async (req, res) => {
  res.status(200).send()
})

app.listen(8080)