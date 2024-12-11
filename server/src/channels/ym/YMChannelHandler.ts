import { Channel, ChannelExecution } from "../../models/channels"
import { ChannelAttribute, ChannelCategory, ChannelHandler } from "../ChannelHandler"
import logger from "../../logger"
import * as temp from 'temp'
import * as xml2js from 'xml2js'
import { Item } from "../../models/items"
import { sequelize } from '../../models'
import { FileManager } from "../../media/FileManager"
import * as fs from 'fs'
import { ItemRelation } from "../../models/itemRelations"
import { ModelManager, ModelsManager } from "../../models/manager"
import { Attribute } from "../../models/attributes"

const dateFormat = require("dateformat")

const fsAsync = require('fs').promises

interface JobContext {
    log: string,
    result: number
}

export class YMChannelHandler extends ChannelHandler {
    public async processChannel(channel: Channel, language: string): Promise<void> {
        logger.debug('YM channel trigered: ' + channel.identifier)
        const chanExec = await this.createExecution(channel)
        const context: JobContext = {log: '', result: 2}

        try {
            let fileName = temp.path({prefix: 'openpim'})

            if (channel.config.ymShopAttributes) {
                const name = this.getValueByExpression(channel.config.ymShopAttributes.find((elem:any) => elem.id === 'name'))
                const company = this.getValueByExpression(channel.config.ymShopAttributes.find((elem:any) => elem.id === 'company'))
                const url = this.getValueByExpression(channel.config.ymShopAttributes.find((elem:any) => elem.id === 'url'))
                const currency1 = this.getValueByExpression(channel.config.ymShopAttributes.find((elem:any) => elem.id === 'currency1'))

                if (name && company && url && currency1) {
                    const yml:any = {yml_catalog : {$: {date: dateFormat(new Date(), 'yyyy-mm-dd HH:MM')}, shop: {name: name, company: company, url: url, currencies:{ currency:[]}}}}

                    channel.config.ymShopAttributes.forEach((attrConfig:any) => {
                        if (attrConfig.id !== 'name' && attrConfig.id !== 'company' && attrConfig.id !== 'url') {
                            const attr = this.getValueByExpression(channel.config.ymShopAttributes.find((elem:any) => elem.id === attrConfig.id))
                            if (attr != null) {
                                if (attrConfig.id.startsWith('currency')) {
                                    const arr = attr.split(',')
                                    yml.yml_catalog.shop.currencies.currency.push({$: {id: arr[0], rate: arr[1]}})
                                } else if (attrConfig.id.startsWith('delivery-option')) {
                                    const arr = attr.split(',')
                                    if (!yml.yml_catalog.shop['delivery-options']) yml.yml_catalog.shop['delivery-options'] = {option: []}
                                    const option:any = {$: {cost: arr[0], days: arr[1]}}
                                    if (arr.length > 2) option.$['order-before'] = arr[2]
                                    yml.yml_catalog.shop['delivery-options'].option.push(option)
                                } else { 
                                    yml.yml_catalog.shop[attrConfig.id] = attr
                                }
                            }
                        }                    
                    })

                    await this.processCategories(channel, yml, language, context)

                    await this.processItems(channel, yml, language, context)
                    
                    logger.info('start YML file creation.')
                    const builder = new xml2js.Builder()
                    const str = builder.buildObject(yml)
                    logger.info('YML file created.')
                    logger.debug('YML file: \n ' + str)
                    
                    await fsAsync.writeFile(fileName, str)
                    if (fs.existsSync(fileName)) {
                        const fm = FileManager.getInstance()
                        fileName = await fm.saveChannelFile(channel.tenantId, channel.id, chanExec, fileName)
                        context.log += '\nсоздан YML файл'
                    }

                    if (channel.config.extCmd) {
                        const cmd = channel.config.extCmd.replace('{file}', fileName)

                        logger.debug('Starting [' + cmd + ']')
                        context.log += '\nЗапускается ' + cmd
                        const result: any = await this.asyncExec(cmd)
                        context.log += result.stdout + (result.stderr ? "\nERRORS:\n" + result.stderr : "") 
                        if (result.code !== 0) {
                            context.result = 3
                            context.log += '\nОшибка запуска: ' + result.code
                        }
                    }
                } else {
                    context.result = 3
                    if (!name) context.log += 'Не задан name в заголовоке YML файла'
                    if (!company) context.log += 'Не задан company в заголовоке YML файла'
                    if (!url) context.log += 'Не задан url в заголовоке YML файла'
                    if (!currency1) context.log += 'Не задана валюта в заголовоке YML файла'
                }
            } else {
                context.result = 3
                context.log += 'Не задан заголовок YML файла'
            }
        } catch (err:any) {
            context.result = 3
            context.log += "Ошибка: " + err.message
            logger.error('Failed to run YM Handler', err)
        } finally {
            await this.finishExecution(channel, chanExec, context.result, context.log)
        }
    }

    private async processItems(channel: Channel, yml: any, language: string, context: JobContext) {
        const offers:any[] = []
        yml.yml_catalog.shop.offers = { offer: offers }

        const query:any = {}
        query[channel.identifier] = {status: 1}
        let items = await Item.findAndCountAll({ 
            where: { tenantId: channel.tenantId, channels: query},
            order: [['parentIdentifier', 'ASC'], ['id', 'ASC']]
        })
        context.log += 'Найдено ' + items.count +' записей для обработки \n\n'
        for (let i = 0; i < items.rows.length; i++) {
            const item = items.rows[i];
            await this.processItem(channel, item, offers, language, context)
            context.log += '\n\n'
        }
    }

    private async processItem(channel: Channel, item: Item, offers: any[], language: string, context: JobContext) {
        context.log += 'Обрабатывается запись с идентификатором: ' + item.identifier +'\n'

        for (const categoryId in channel.mappings) {
            const categoryConfig = channel.mappings[categoryId]
            if (categoryConfig.valid && categoryConfig.valid.length > 0 && categoryConfig.visible && categoryConfig.visible.length > 0) {
                const pathArr = item.path.split('.')
                const tst1 = categoryConfig.valid.includes(item.typeId) || categoryConfig.valid.includes(''+item.typeId)
                
                let tst2 = null
                if (categoryConfig.visibleRelation) {
                    let sources = await Item.findAll({ 
                        where: { tenantId: channel.tenantId, '$sourceRelation.relationId$': categoryConfig.visibleRelation, '$sourceRelation.targetId$': item.id },
                        include: [{model: ItemRelation, as: 'sourceRelation'}]
                    })
                    tst2 = sources.some(source => {
                        const pathArr = source.path.split('.')
                        return categoryConfig.visible.find((elem:any) => pathArr.includes(''+elem))
                    })
                } else {
                    tst2 = categoryConfig.visible.find((elem:any) => pathArr.includes(''+elem))
                }

                if (tst1 && tst2) {
                    await this.processAndSaveItemInCategory(channel, item, offers, categoryConfig, language, context)
                    return
                }
            }
        }

        await this.processAndSaveItemInCategory(channel, item, offers, channel.mappings._default, language, context)
    }

    async processAndSaveItemInCategory(channel: Channel, item: Item, offers: any[], categoryConfig: any, language: string, context: JobContext) {
        let variants:any[] = []
        const tmp = await this.evaluateExpression(channel, item, channel.config.variantExpr)
        if (tmp && Array.isArray(tmp)) {
            for(const variant of tmp) {
                try {
                    await this.processItemInCategory(channel, item, offers, categoryConfig, language, context, variant)
                    await sequelize.transaction(async (t) => {
                        await item.save({transaction: t})
                    })
                } catch (err) {
                    logger.error("Failed to process item with id: " + item.id + " for tenant: " + item.tenantId, err)
                }
            }
        } else {
            try {
                await this.processItemInCategory(channel, item, offers, categoryConfig, language, context, null)
                await sequelize.transaction(async (t) => {
                    await item.save({transaction: t})
                })
            } catch (err) {
                logger.error("Failed to process item with id: " + item.id + " for tenant: " + item.tenantId, err)
            }
        }
    }

    async processItemInCategory(channel: Channel, item: Item, offers: any[], categoryConfig: any, language: string, context: JobContext, variant: any) {
        context.log += 'Найдена категория "' + categoryConfig.name +'" для записи с идентификатором: ' + item.identifier + '\n'

        const data = item.channels[channel.identifier]
        data.category = categoryConfig.id

        // const category: any ={$: {id: id}, _: name }
        const idConfig = categoryConfig.attributes.find((elem:any) => elem.id === 'id')
        const id = await this.getValueByMapping2(channel, idConfig, item, language, variant)
        if (!id) {
            const msg = 'Не введена конфигурация для "id" для категории: ' + categoryConfig.name
            context.log += msg
            this.reportError(channel, item, msg)
            return
        }

        try {
            const availableConfig = categoryConfig.attributes.find((elem:any) => elem.id === 'available')
            const available = await this.getValueByMapping2(channel, availableConfig, item, language, variant)
    
            const offer: any = {$: {id: id}}
            if (available !== null && available !== undefined) offer.$.available = available

            if (categoryConfig.type === 'vendor.model') offer.$.type = 'vendor.model'
            if (categoryConfig.type === 'medicine') offer.$.type = 'medicine'
            if (categoryConfig.type === 'books') offer.$.type = 'book'

            const typeConfig = categoryConfig.attributes.find((elem:any) => elem.id === 'offerType')
            const type = await this.getValueByMapping2(channel, typeConfig, item, language, variant)
            if (type) offer.$.type = type


            // atributes
            for (let i = 0; i < categoryConfig.attributes.length; i++) {
                const attrConfig = categoryConfig.attributes[i]
                
                if (attrConfig.id != 'id' && attrConfig.id != 'available' && attrConfig.id != 'offerType') {
                    let value = await this.getValueByMapping2(channel, attrConfig, item, language, variant)
                    if (value != null) {
                        if (typeof value === 'string') value = value.replaceAll(/((?:[\0-\x08\x0B\f\x0E-\x1F\uFFFD\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]))/g, '')
                        if (attrConfig.id != 'group_id') {
                            if (attrConfig.id.startsWith('delivery-option')) {
                                const arr = value.split(',')
                                if (!offer['delivery-options']) offer['delivery-options'] = {option: []}
                                const option:any = {$: {cost: arr[0], days: arr[1]}}
                                if (arr.length > 2) option.$['order-before'] = arr[2]
                                offer['delivery-options'].option.push(option)
                            } else if (attrConfig.id === 'outlets') {
                                const outlets:any[] = []
                                if (Array.isArray(value)) {
                                    value.forEach(elem => {
                                        if (Array.isArray(elem) && elem.length >= 2) outlets.push({outlet: {$: {id: ''+elem[0], instock: ''+elem[1]}}})
                                    })
                                }
                                if (outlets.length > 0) offer.outlets = outlets
                            } else if (Array.isArray(value)) {
                                if (offer[attrConfig.id]) offer[attrConfig.id] = [offer[attrConfig.id]]
                                    else offer[attrConfig.id] = []
                                value.forEach(elem => {
                                    offer[attrConfig.id].push(elem)
                                })
                            } else {
                                offer[attrConfig.id] = value
                            }
                        }
                    }
                }
            }

            // addition params
            for (let i = 0; i < categoryConfig.params.length; i++) {
                const paramConfig = categoryConfig.params[i]
                let value = await this.getValueByMapping2(channel, paramConfig, item, language, variant)
                if (value) {
                    if (typeof value === 'string') value = value.replaceAll(/((?:[\0-\x08\x0B\f\x0E-\x1F\uFFFD\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]))/g, '')
                        if (!offer.param) offer.param =[]
                    if (Array.isArray(value)) {
                            if (paramConfig.id === 'picture') {
                                if (offer.picture && !Array.isArray(offer.picture)) offer.picture = [offer.picture]
                                    else if (!offer.picture) offer.picture = []
                            }
                            value.forEach(elem => {
                            if (paramConfig.id === 'picture') {
                                offer.picture.push(elem)
                            } else {
                                offer.param.push({$:{name: paramConfig.id}, _: elem})
                            }
                        })
                    } else {
                        if (paramConfig.id === 'picture') offer.picture = value 
                            else offer.param.push({$:{name: paramConfig.id}, _: value})
                    }
                }
            }

            if (categoryConfig.attrGroups && categoryConfig.attrGroups.length > 0) {
                // TODO
                const mng = ModelsManager.getInstance().getModelManager(channel.tenantId)
                const groupIds = categoryConfig.attrGroups.map((elem:any) => parseInt(elem))
                const attrs = this.getAttributesForGroups(mng, item, groupIds)
                for (let i = 0; i < attrs.length; i++) {
                    const attr = attrs[i]
                    let name = attr.name.ru
                    const idx = name.indexOf(' (')
                    if (idx != -1) name = name.substring(0, idx)
                    const paramConfig = {id:name, attrIdent: attr.identifier}
                    let value = await this.getValueByMapping2(channel, paramConfig, item, language, variant)
                    if (value) {
                        if (!offer.param) offer.param =[]
                        if (Array.isArray(value)) {
                            value.forEach(elem => {
                                offer.param.push({$:{name: paramConfig.id}, _: elem})
                            })
                        } else {
                            if (value instanceof Object) value = value[language]
                            if (value) offer.param.push({$:{name: paramConfig.id}, _: value})
                        }
                    }
                }
            }

            offers.push(offer)
            context.log += 'Запись с идентификатором: ' + item.identifier + ' обработана успешно.\n'
            data.status = 2
            data.message = ''
            data.syncedAt = Date.now()
            item.changed('channels', true)
        } catch (err:any) {
            const msg = 'Ошибка обработки записи: ' + err.message
            context.log += msg
            this.reportError(channel, item, msg)
        }
    }

    private getAttributesForGroups(mng: ModelManager, item: Item, groupIds?: number[]) {
        const attrArr: Attribute[] = []
        const pathArr: number[] = item.path.split('.').map(elem => parseInt(elem))

        mng.getAttrGroups().forEach(group => {
            if (group.getGroup().visible && (!groupIds || groupIds.includes(group.getGroup().id))) {
                group.getAttributes().forEach(attr => {
                    if (attr.valid.includes(item.typeId)) {
                        for (let i=0; i<attr.visible.length; i++ ) {
                            const visible: number = attr.visible[i]
                            if (pathArr.includes(visible)) {
                                if (!attrArr.find(tst => tst.identifier === attr.identifier)) attrArr.push(attr)
                                break
                            }
                        }
                    }
                })
            }
        })
        return attrArr
    }


    private async processCategories(channel: Channel, yml: any, language: string, context: JobContext) {
        if (!channel.config.ymCategoryFrom) {
            context.result = 3
            context.log += "Не задан объект с которого начать генерацию категорий"
            return
        }
        if (!channel.config.ymCategoryTypes || channel.config.ymCategoryTypes.length === 0) {
            context.result = 3
            context.log += "Не заданы типы для генерации категорий"
            return
        }
        if (!channel.config.ymCategoryAttributes || channel.config.ymCategoryAttributes.length === 0) {
            context.result = 3
            context.log += "Не заданы id и Названия для категорий"
            return
        }

        const idConfig = channel.config.ymCategoryAttributes.find((elem:any) => elem.id === 'id')
        if (!idConfig) {
            context.result = 3
            context.log += "Не задано id для категорий"
            return
        }
        const nameConfig = channel.config.ymCategoryAttributes.find((elem:any) => elem.id === 'name')
        if (!nameConfig) {
            context.result = 3
            context.log += "Не задано название для категорий"
            return
        }
        
        const categories:any[] = []
        yml.yml_catalog.shop.categories = { category: categories }

        const itemFrom = await Item.findOne({ where: { tenantId: channel.tenantId, id: channel.config.ymCategoryFrom }})
        if (!itemFrom) {
            context.result = 3
            context.log += "Не найдет объект с которого начинать по id: " + channel.config.ymCategoryFrom
            return
        }

        const items = await sequelize.query('SELECT * FROM items where "deletedAt" IS NULL and "tenantId"=:tenant and path~:lquery order by path', {
            replacements: { 
                tenant: channel.tenantId,
                lquery: itemFrom.path + '.*'
            },
            model: Item,
            mapToModel: true
        })

        let parents = [itemFrom]
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.id === itemFrom.id) continue

            let parent = parents[parents.length-1]
            if (parent.identifier !== item.parentIdentifier) {
                const idx = parents.findIndex(elem => elem.identifier === item.parentIdentifier)
                if (idx === -1) {
                    parent = items[i-1]
                    parents.push(parent)
                } else {
                    parents.splice(idx+1)
                    parent = parents[parents.length-1]
                }
            }

            if (!channel.config.ymCategoryTypes.includes(item.typeId)) continue

            const id = await this.getValueByMapping(channel, idConfig, item, language)
            if (!id) {
                context.result = 3
                context.log += "Не найдет id для категории с идентификатором: " + item.identifier
                return
            }

            const name = await this.getValueByMapping(channel, nameConfig, item, language)
            if (!name) {
                context.result = 3
                context.log += "Не найдено название для категории с идентификатором: " + item.identifier
                return
            }

            const category: any ={$: {id: id}, _: name }
            if (parent.identifier !== itemFrom.identifier) {
                const parentId = await this.getValueByMapping(channel, idConfig, parent, language)
                category.$.parentId = parentId
            }
            categories.push(category)
        }
    }

    public async getCategories(channel: Channel): Promise<{list: ChannelCategory[]|null, tree: ChannelCategory|null}> {
        return {list: [], tree : null}
    }

    public async getAttributes(channel: Channel, categoryId: string): Promise<ChannelAttribute[]> {
        return []
    }
}