const { Op } = require("sequelize");

import * as fs from 'fs'
import * as sax from 'sax'
import { Process } from '../models/processes'
import { ImportConfig } from '../models/importConfigs'
import { IItemImportRequest, IImportConfig, ImportMode, ErrorProcessing } from '../models/import'
import { importItem } from '../resolvers/import/items'
import Context from '../context'
import XLSX from 'xlsx'
import { File } from 'formidable'
import logger from "../logger"
import { processImportActions, replaceOperations } from '../resolvers/utils'
import { EventType } from '../models/actions'
import i18next from '../i18n'
import { Item } from '../models/items'
import { ModelsManager } from '../models/manager'
import { LOV } from '../models/lovs'

export class ImportManager {
    private static instance: ImportManager
    private filesRoot: string

    private constructor() {
        this.filesRoot = process.env.FILES_ROOT!
    }

    public static getInstance(): ImportManager {
        if (!ImportManager.instance) {
            ImportManager.instance = new ImportManager()
        }
        return ImportManager.instance
    }

    public async processImportFile(context: Context, process: Process, importConfig: ImportConfig, filepath: any, language: string) {
        if (importConfig.type !== 3) {
            await this.processImportFileXLSX(context, process, importConfig, filepath, language)
        } else {
            await this.processImportFileXML(context, process, importConfig, filepath, language)
        }
    }

    private async processImportFileXLSX(context: Context, process: Process, importConfig: ImportConfig, filepath: any, language: string) {
        try {
            const result: any = await processImportActions(context, EventType.ImportBeforeStart, process, importConfig, filepath)
            const config = importConfig.config
            const data: any = await this.getImportConfigFileData(result?.[0]?.data?.filepath || filepath)

            let { selectedTab, headerLineNumber, dataLineNumber, limit } = config

            // data for selected tab only
            const selectedData = data[selectedTab]
            if (selectedData) {
                headerLineNumber = parseInt(headerLineNumber) - 1
                dataLineNumber = parseInt(dataLineNumber) - 1
                limit = parseInt(limit)

                const headers = selectedData[headerLineNumber]

                const startRowNumber = dataLineNumber
                const endRowNumber = limit ? dataLineNumber + limit : selectedData.length

                const importConfigOptions: IImportConfig = {
                    mode: ImportMode.CREATE_UPDATE,
                    errors: ErrorProcessing.PROCESS_WARN
                }

                for (let i = startRowNumber; i < endRowNumber; i++) {
                    const rowData = selectedData[i] || null
                    if (rowData) {
                        try {
                            const res = (config.beforeEachRow && config.beforeEachRow.length) ? await this.evaluateExpression(rowData, null, config.beforeEachRow, context) : null
                            if (res && typeof res == 'boolean') {
                                process.log += '\n' + `${i18next.t('ImportManagerValueSkipped', { lng: language })} ${JSON.stringify(rowData)}`
                                continue
                            }
                            if (res) {
                                process.log += '\n' + `${i18next.t('ImportManagerRowSkipped', { lng: language })} ${JSON.stringify(rowData)}`
                                continue
                            }
                            const item = await this.mapLine(headers, importConfig, rowData, context)
                            process.log += '\n' + `${i18next.t('ImportManagerItem', { lng: language })} ` + JSON.stringify(item)
                            if (item.identifier && typeof item.identifier !== 'undefined' && (item.identifier + '').length) {
                                const importRes = await importItem(context, <IImportConfig>importConfigOptions, <IItemImportRequest>item)
                                process.log += '\n' + `${i18next.t('ImportManagerImportResult', { lng: language })} ${JSON.stringify(importRes)}`
                            } else {
                                process.log += '\n' + `${i18next.t('ImportManagerItemIdentifierIsEmpty', { lng: language })}`
                            }
                        } catch (e) {
                            process.log += '\n' + `${i18next.t('ImportManagerErrorUpdatingItem', { lng: language })} ${e}`
                        }
                        await process.save()
                    } else {
                        process.log += '\n' + `${i18next.t('ImportManagerThereIsNoDataForLine', { lng: language })} ${i}}`
                        await process.save()
                    }
                }

                process.log += '\n' + `${i18next.t('ImportManagerFileProcessingFinished', { lng: language })}`
            } else {
                process.log += '\n' + `${i18next.t('ImportManagerUploadedFileHasInvalidFormat', { lng: language })}`
            }

            processImportActions(context, EventType.ImportAfterEnd, process, importConfig, filepath)

            process.active = false
            process.status = i18next.t('Finished', { lng: language })
            process.finishTime = Date.now()
            await process.save()
        } catch (e) {
            logger.error('Failed to import', e)
            process.log += '\n' + `${i18next.t('ImportManagerError', { lng: language })} ${e}`
            process.active = false
            process.status = i18next.t('Finished', { lng: language })
            process.finishTime = Date.now()
            await process.save()
        }
    }

    private async processImportFileXML(context: Context, process: Process, importConfig: ImportConfig, filepath: any, language: string) {
        try {
            const result: any = await processImportActions(context, EventType.ImportBeforeStart, process, importConfig, filepath)
            const mng = this

            // let saxStream = sax.createStream(true, { lowercase: true })
            let saxStream = sax.createStream(true)
            const readable = fs.createReadStream(result?.[0]?.data?.filepath || filepath, { highWaterMark: 8 })
            readable.pipe(saxStream)

            let offerChilds: any = []
            // let categoryChilds: any = []
            let currentTag: any = null
            let offersCount = 0
            let categoriesCount = 0
            let offer: any = null
            let category: any = null

            saxStream.on('opentag', function (node: any) {
                currentTag = node
                if (currentTag.name === 'offer') {
                    offer = currentTag
                }
                if (offer && currentTag.name !== 'offer') {
                    offerChilds.push(currentTag)
                }
                if (currentTag.name === 'category') {
                    category = currentTag
                }
                /* if (category && currentTag.name !== 'category') {
                    categoryChilds.push(currentTag)
                } */
            })

            saxStream.on('closetag', async function (node: any) {
                // const catCount = categoriesCount
                // const offCount = offersCount
                if (node === 'category') {
                    categoriesCount++
                    const data = { ...category }
                    // data.childs = [...categoryChilds]
                    category = null
                    // categoryChilds = []
                    readable.pause()
                    await mng.updateItemByImportConfig(context, process, importConfig, data, 'category', language)
                    readable.resume()
                }
                if (node === 'offer') {
                    offersCount++
                    const data = { ...offer }
                    data.childs = [...offerChilds]
                    offer = null
                    offerChilds = []
                    readable.pause()
                    await mng.updateItemByImportConfig(context, process, importConfig, data, 'offer', language)
                    readable.resume()
                }
                currentTag = null
            })

            saxStream.on('text', function (t: any) {
                if (currentTag) currentTag.text = t
            })

            saxStream.on('end', async function () {
                processImportActions(context, EventType.ImportAfterEnd, process, importConfig, filepath)
                process.active = false
                process.status = i18next.t('Finished', { lng: language })
                process.finishTime = Date.now()
                await process.save()
            })

            saxStream.on('error', async function (e:any) {
                logger.error('Failed to import', e)
                process.log += '\n' + `${i18next.t('ImportManagerError', { lng: language })} ${e}`
                process.active = false
                process.status = i18next.t('Finished', { lng: language })
                process.finishTime = Date.now()
                await process.save()
            })

        } catch (e) {
            logger.error('Failed to import', e)
            process.log += '\n' + `${i18next.t('ImportManagerError', { lng: language })} ${e}`
            process.active = false
            process.status = i18next.t('Finished', { lng: language })
            process.finishTime = Date.now()
            await process.save()
        }
    }

    private async updateItemByImportConfig(context: Context, process: Process, importConfig: ImportConfig, data:any, entity:string, language: string) {
        const config = importConfig.config
        const importConfigOptions: IImportConfig = {
            mode: ImportMode.CREATE_UPDATE,
            errors: ErrorProcessing.PROCESS_WARN
        }
        try {
            const res = (config.beforeEachRow && config.beforeEachRow.length) ? await this.evaluateExpression(data, null, config.beforeEachRow, context) : null
            if (res && typeof res == 'boolean') {
                process.log += '\n' + `${i18next.t('ImportManagerValueSkipped', { lng: language })} ${JSON.stringify(data)}`
            }
            if (res) {
                process.log += '\n' + `${i18next.t('ImportManagerRowSkipped', { lng: language })} ${JSON.stringify(data)}`
            }
            const item = await this.mapLineXML(importConfig, entity, data, context)

            process.log += '\n' + `${i18next.t('ImportManagerItem', { lng: language })} ` + JSON.stringify(item)
            if (item.identifier && typeof item.identifier !== 'undefined' && (item.identifier + '').length) {
                const importRes = await importItem(context, <IImportConfig>importConfigOptions, <IItemImportRequest>item)
                process.log += '\n' + `${i18next.t('ImportManagerImportResult', { lng: language })} ${JSON.stringify(importRes)}`
            } else {
                process.log += '\n' + `${i18next.t('ImportManagerItemIdentifierIsEmpty', { lng: language })}`
            }
        } catch (e) {
            process.log += '\n' + `${i18next.t('ImportManagerErrorUpdatingItem', { lng: language })} ${e}`
        }
        await process.save()
    }

    private async mapLineXML(importConfig: ImportConfig, entity: string, data: any, context: Context) {
        const result: any = {
            name: {},
            values: {}
        }
        const entityMappings = entity === 'category' ? importConfig.mappings.categories : importConfig.mappings.offers
        try {
            for (let i = 0; i < entityMappings.length; i++) {
                const mapping = entityMappings[i]

                let found
                
                if (entity === 'offer') {
                    if (mapping.source === 'attribute') {
                        found = data.attributes[mapping.column.toLowerCase()]
                    } else {
                        found = !(mapping.source === 'parameter') ? data.childs.find((el: any) => el.name === mapping.column) : data.childs.find((el: any) => el.name === 'param' && el.attributes['name'] === mapping.column)
                    }
                    if (found && found.text) found = found.text
                } else if (entity === 'category') {
                    found = mapping.column === 'name' ? data.text : data.attributes[mapping.column]
                }

                if ((found || (!found && mapping.expression)) && mapping.attribute && mapping.attribute.length) {
                    const mappedData = (mapping.expression && mapping.expression.length) ? await this.evaluateExpression(data, found, mapping.expression, context) : found
                    if ((mapping.attribute !== 'identifier' && mapping.attribute !== 'typeIdentifier' && mapping.attribute !== 'parentIdentifier') && !mapping.attribute.startsWith('$name#')) {
                        result.values[mapping.attribute] = mappedData
                    } else if (mapping.attribute.startsWith('$name#')) {
                        const langIdentifier = mapping.attribute.substring(6)
                        result.name[langIdentifier] = mappedData
                    } else {
                        result[mapping.attribute] = mappedData
                    }
                }
            }
        } catch (e: any) {
            throw new Error(e)
        }
        return result
    }

    private async mapLine(headers: Array<any>, importConfig: ImportConfig, data: Array<any>, context: Context) {
        const result: any = {
            name: {},
            values: {}
        }
        try {
            for (let i = 0; i < importConfig.mappings.length; i++) {
                const mapping = importConfig.mappings[i]

                let idx = -1
                if (importConfig.config.noHeadersChecked && mapping.column) {
                    // calculates an index from string like 'Column 10'
                    idx = parseInt(mapping.column.substring(7)) - 1
                } else if (mapping.column) {
                    idx = headers.indexOf(mapping.column)
                }

                if ((idx !== -1 || (idx === -1 && mapping.expression)) && mapping.attribute && mapping.attribute.length) {
                    const mappedData = (mapping.expression && mapping.expression.length) ? await this.evaluateExpression(data, data[idx], mapping.expression, context) : data[idx]
                    if ((mapping.attribute !== 'identifier' && mapping.attribute !== 'typeIdentifier' && mapping.attribute !== 'parentIdentifier') && !mapping.attribute.startsWith('$name#')) {
                        result.values[mapping.attribute] = mappedData
                    } else if (mapping.attribute.startsWith('$name#')) {
                        const langIdentifier = mapping.attribute.substring(6)
                        result.name[langIdentifier] = mappedData
                    } else {
                        result[mapping.attribute] = mappedData
                    }
                }
            }
        } catch (e: any) {
            throw new Error(e)
        }
        return result
    }

    private async evaluateExpression(row: Array<any>, data: any, expression: string, context: Context): Promise<any> {
        try {
            const utils = {
                findItem: async (condition: any) => {
                    logger.debug(`Executing evaluateExpression findItem, condition: ${JSON.stringify(condition)}`)
                    replaceOperations(condition)
                    const item = await Item.findOne({
                        where: {
                            [Op.and]: [
                                condition,
                                { tenantId: context.getCurrentUser()?.tenantId }
                            ]
                        }
                    })
                    logger.debug(`findItem result: ${item?.identifier}`)
                    return item
                },
                findLOV: async (lovIdentifier: string, value: string, lang = 'en', caseInsensitive = false, createIfNotExists = false) => {
                    //console.log(JSON.stringify(value))
                    const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)
                    let lov: LOV | undefined | null = mng.getCache().get('IM_LOV_' + lovIdentifier)
                    if (!lov) {
                        lov = await LOV.applyScope(context).findOne({ where: { identifier: lovIdentifier } })
                        if (!lov) throw new Error(`Failed to find LOV by identifier: ${lovIdentifier}`)
                        logger.debug(`findLOV: lov found`)
                        mng.getCache().set('IM_LOV_' + lovIdentifier, lov, 60 * 60)
                    }
                    const valueLowerCase = value ? ('' + value).toLowerCase() : null
                    let val = lov.values.find((elem: any) => {
                        if (!caseInsensitive) {
                            return elem.value[lang] == value
                        } else {
                            const elemVal = elem.value[lang] ? elem.value[lang].toLowerCase() : null
                            return elemVal == valueLowerCase
                        }
                    })
                    logger.debug(`findLOV: value found: ${JSON.stringify(val)}`)
                    if (!val && createIfNotExists) {
                        const max = lov.values.reduce((prev: any, current: any) => (prev.id > current.id) ? prev : current)
                        val = { id: max ? max.id + 1 : 1, value: {}, filter: null }
                        val.value[lang] = value
                        lov.values.push(val)
                        lov.changed('values', true)
                        logger.debug(`findLOV: new value created: ${JSON.stringify(val)}`)
                        await lov.save()
                    }
                    return val?.id
                },
                getCache: () => {
                    const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)
                    return mng.getCache()
                }
            }
            const func = new Function('row', 'data', 'utils', 'logger', '"use strict"; return (async () => { return (' + expression + ')})()')
            return await func(row, data, utils, logger)
        } catch (err: any) {
            logger.error('Failed to execute expression :[' + expression + '] for data: ' + data + ' with error: ' + err.message)
            throw err
        }
    }

    public async saveImportConfigTemplateFile(tenantId: string, file: File, clean = true) {
        const tst = '/' + tenantId
        if (!fs.existsSync(this.filesRoot + tst)) fs.mkdirSync(this.filesRoot + tst)

        const filesPath = '/' + tenantId + '/importconfigs/'
        if (!fs.existsSync(this.filesRoot + filesPath)) fs.mkdirSync(this.filesRoot + filesPath, { recursive: true })

        const relativePath = filesPath + new Date().getTime()
        const fullPath = this.filesRoot + relativePath

        if (clean) {
            try {
                fs.renameSync(file.filepath, fullPath)
            } catch (e) {
                fs.copyFileSync(file.filepath, fullPath)
                fs.unlinkSync(file.filepath)
            }
        } else {
            fs.copyFileSync(file.filepath, fullPath)
        }

        const info = {
            storagePath: relativePath,
            mimeType: file.mimetype,
            fileName: file.originalFilename
        }

        const data = await this.getImportConfigFileData(fullPath)
        const res = { info, data }

        return res
    }

    public async getImportConfigFileData(filePath: string) {
        return new Promise((resolve, reject) => {
            if (!filePath) reject(new Error('No filepath specified'))
            try {
                const wb = XLSX.readFile(filePath)
                const sheetData: any = {}
                for (let i = 0; i < wb.SheetNames.length; i++) {
                    const ws = wb.Sheets[wb.SheetNames[i]]
                    if (!ws || !ws['!ref']) continue
                    const options = { header: 1 }
                    sheetData[wb.SheetNames[i]] = XLSX.utils.sheet_to_json(ws, options)
                }
                resolve(sheetData)
            } catch (err) {
                reject(err)
            }
        })
    }

/*     private async getImportConfigXMLFileData(filePath: string) {
        return new Promise((resolve, reject) => {
            if (!filePath) reject(new Error('No filepath specified'))
            try {
                const filedata = fs.readFileSync(filePath, 'utf8')
                xml2js.parseString(filedata, function (err, result) {
                    if (err) {
                        reject(err)
                    }
                    resolve(result)
                })
            } catch (err) {
                reject(err)
            }
        })
    } */
}
