import { APIGatewayProxyHandler } from "aws-lambda"
import { document } from '../utils/dynamodbClient'
import { compile } from "handlebars"
import dayjs from 'dayjs'

import { join } from "path"
import { readFileSync } from "fs"

import chromium from 'chrome-aws-lambda'
import { S3 } from 'aws-sdk'

interface ITemplate {
  id: string;
  name: string;
  grade: string;
  medal: string;
  date: string;
}

const compileTemplate = async (data: ITemplate) => {
  // raiz project cwd()
  const filePath = join(process.cwd(), "src", "templates", "certificate.hbs")
  const html = readFileSync(filePath, 'utf-8')
  return compile(html)(data)
}

interface ICreateCertificate {
  id: string,
  name: string,
  grade: string
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const { id, name, grade } = JSON.parse(event.body) as ICreateCertificate

  const response = await document.query({
    TableName: 'users_certificate',
    KeyConditionExpression: 'id = :id',
    ExpressionAttributeValues: {
      ':id': id
    }
  }).promise();

  const userExists = response.Items[0]
  if (!userExists) {
    // insert document
    await document.put({
      TableName: 'users_certificate',
      Item: {
        id,
        name,
        grade,
        created_at: new Date().getTime(),
      }
    }).promise();
  }


  //informations


  const medalPath = join(process.cwd(), 'src', 'templates', 'selo.png')
  const medal = readFileSync(medalPath, 'base64')

  const data: ITemplate = {
    name, id, grade, date: dayjs().format('DD/MM/YYYY'), medal
  }
  const content = await compileTemplate(data)

  const browser = await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    userDataDir: '/dev/null'
  })

  const page = await browser.newPage()
  await page.setContent(content)
  const pdf = await page.pdf({
    format: 'a4',
    landscape: true,
    printBackground: true,
    preferCSSPageSize: true,
    path: process.env.IS_OFFLINE ? './certificate.pdf' : null
  })
  await browser.close();

  const s3 = new S3();
  // await s3.createBucket({
  //   Bucket: 'certificatenodejsignitewilldev'
  // }).promise()

  await s3.putObject({
    Bucket: 'certificatenodejsignitewilldev',
    Key: `${id}.pdf`,
    ACL: "public-read",
    Body: pdf,
    ContentType: 'application/pdf'
  }).promise();

  return {
    statusCode: 201,
    body: JSON.stringify({
      message: 'certificate created success',
      url: `https://certificatenodejsignitewilldev.s3.amazonaws.com/${id}.pdf`
    })
  }
}