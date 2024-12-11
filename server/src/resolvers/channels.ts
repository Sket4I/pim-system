import Context, { ConfigAccess } from '../context'
import { ModelManager, ModelsManager } from '../models/manager'
import { sequelize } from '../models'
import { Channel, ChannelExecution } from '../models/channels'
import { Item } from '../models/items'
import { fn, literal, Op } from 'sequelize'
import { ChannelsManagerFactory } from '../channels'
import { replaceOperations, processBulkUpdateChannelsActions } from './utils'
import { EventType } from '../models/actions'
import { updateChannelMappings } from './import/channels'

export default {
    Query: {
        getChannelTypes: async (parent: any, args: any, context: Context) => {
            context.checkAuth()
            
            return ModelsManager.getInstance().getChannelTypes()
        },
        getChannels: async (parent: any, args: any, context: Context) => {
            context.checkAuth()
            
            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)
            let cloned = JSON.parse(JSON.stringify(mng.getChannels()))
            cloned.forEach((channel:Channel) => {
                if (channel.type === 2 && channel.config.wbToken) { // WB
                    channel.config.wbToken = '*****'
                } else if (channel.type === 3 && channel.config.ozonApiKey) { // Ozon
                    channel.config.ozonApiKey = '*****'
                }
            })
            return cloned
        },
        getChannelStatus: async (parent: any, { id }: any, context: Context) => {
            context.checkAuth()
            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const nId = parseInt(id)
            const chan = mng.getChannels().find( chan => chan.id === nId)
            if (!chan) {
                throw new Error('Failed to find channel by id: ' + id + ', tenant: ' + mng.getTenantId())
            }
            if (!context.canViewChannel(chan.identifier)) {
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to view channel, tenant: ' + context.getCurrentUser()!.tenantId)
            }
            
            const groupExpression = fn('jsonb_extract_path', literal('channels'), chan.identifier, 'status')
            const whereExpression: any = {channels: {}}
            whereExpression.channels[chan.identifier] =  { [Op.ne]: null}
            const result: any = await Item.applyScope(context).findAll({
                attributes: [
                    [fn('count', '*'), 'count'],
                    [groupExpression, 'status']
                ],
                where: whereExpression,
                group: [groupExpression]
            })

            const res = result.map((record: any) => { return {status: record.getDataValue('status'), count: record.getDataValue('count')} })
            return res
        },
        getChannelStatusByCategories: async (parent: any, { id }: any, context: Context) => {
            context.checkAuth()
            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const nId = parseInt(id)
            const chan = mng.getChannels().find( chan => chan.id === nId)
            if (!chan) {
                throw new Error('Failed to find channel by id: ' + id + ', tenant: ' + mng.getTenantId())
            }
            if (!context.canViewChannel(chan.identifier)) {
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to view channel, tenant: ' + context.getCurrentUser()!.tenantId)
            }
            
            const groupExpression = fn('jsonb_extract_path', literal('channels'), chan.identifier, 'category')
            const groupExpression2 = fn('jsonb_extract_path', literal('channels'), chan.identifier, 'status')
            const whereExpression: any = {channels: {}}
            whereExpression.channels[chan.identifier] =  { [Op.ne]: null}
            const result: any = await Item.applyScope(context).findAll({
                attributes: [
                    [fn('count', '*'), 'count'],
                    [groupExpression, 'category'],
                    [groupExpression2, 'status']
                ],
                where: whereExpression,
                group: [groupExpression, groupExpression2]
            })

            const res:any[] = []
            result.forEach((record:any) => {
                const category = record.getDataValue('category')
                let data = res.find(elem => elem.id === category)
                if (!data) {
                    let name = null
                    if (category) {
                        for(const prop in chan.mappings) {
                            const catMap = chan.mappings[prop]
                            if (catMap.id === category) name = catMap.name
                        }
                    }
                    data = {id: category, name: name, statuses: [{status: 1, count: 0},{status: 2, count: 0},{status: 3, count: 0},{status: 4, count: 0}]}
                    res.push(data)
                }
                const status = record.getDataValue('status')
                const statData = data.statuses.find((elem:any) => elem.status === status)
                statData.count = record.getDataValue('count')
            })
            return res
        },
        getExecutions: async (parent: any, {channelId, offset, limit, order}: any, context: Context) => {
            context.checkAuth()
            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const nId = parseInt(channelId)
            const chan = mng.getChannels().find( chan => chan.id === nId)
            if (!chan) {
                throw new Error('Failed to find channel by id: ' + nId + ', tenant: ' + mng.getTenantId())
            }
            if (!context.canViewChannel(chan.identifier)) {
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to view channel, tenant: ' + context.getCurrentUser()!.tenantId)
            }

            const res = await ChannelExecution.applyScope(context).findAndCountAll({
                where: {
                    channelId: nId
                },
                order: order,
                offset: offset,
                limit: limit === -1 ? null : limit
            })

            return res
        },
        getExecutionById: async (parent: any, { id }: any, context: Context) => {
            context.checkAuth()
            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const execution = await ChannelExecution.applyScope(context).findOne({
                where: { id }
            })

            if (!execution) {
                throw new Error(`Execution with id ${id} not found`)
            }

            const channelId = execution.channelId
            const channel = mng.getChannels().find(chan => chan.id === channelId)

            if (!channel) {
                throw new Error(`Channel not found for id: ${channelId}, tenant: ${context.getCurrentUser()!.tenantId}`)
            }

            if (!context.canViewChannel(channel.identifier)) {
                throw new Error(
                    `User ${context.getCurrentUser()?.id} does not have permissions to view channel with identifier ${channel.identifier}, tenant: ${context.getCurrentUser()!.tenantId}`
                )
            }

            return execution
        },
        getChannelCategories: async (parent: any, { id }: any, context: Context) => {
            context.checkAuth()
            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const nId = parseInt(id)
            const chan = mng.getChannels().find( chan => chan.id === nId)
            if (!chan) {
                throw new Error('Failed to find channel by id: ' + id + ', tenant: ' + mng.getTenantId())
            }
            if (!context.canViewChannel(chan.identifier)) {
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to view channel, tenant: ' + context.getCurrentUser()!.tenantId)
            }
            const channelMng = ChannelsManagerFactory.getInstance().getChannelsManager(context.getCurrentUser()!.tenantId)
            return channelMng.getHandler(chan).getCategories(chan)
        },
        getChannelAttributes: async (parent: any, { channelId, categoryId }: any, context: Context) => {
            context.checkAuth()
            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const nId = parseInt(channelId)
            const chan = mng.getChannels().find( chan => chan.id === nId)
            if (!chan) {
                throw new Error('Failed to find channel by id: ' + channelId + ', tenant: ' + mng.getTenantId())
            }
            if (!context.canViewChannel(chan.identifier)) {
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to view channel, tenant: ' + context.getCurrentUser()!.tenantId)
            }
            const channelMng = ChannelsManagerFactory.getInstance().getChannelsManager(context.getCurrentUser()!.tenantId)
            return channelMng.getHandler(chan).getAttributes(chan, categoryId)
        },
        getChannelAttributeValues: async (parent: any, { channelId, categoryId, attributeId }: any, context: Context) => {
            context.checkAuth()
            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const nId = parseInt(channelId)
            const chan = mng.getChannels().find( chan => chan.id === nId)
            if (!chan) {
                throw new Error('Failed to find channel by id: ' + channelId + ', tenant: ' + mng.getTenantId())
            }
            if (!context.canViewChannel(chan.identifier)) {
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to view channel, tenant: ' + context.getCurrentUser()!.tenantId)
            }
            const channelMng = ChannelsManagerFactory.getInstance().getChannelsManager(context.getCurrentUser()!.tenantId)
            return channelMng.getHandler(chan).getChannelAttributeValues(chan, categoryId, attributeId)
        }
    },
    Mutation: {
        triggerChannel: async (parent: any, { id, language, data }: any, context: Context) => {
            context.checkAuth()
            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const nId = parseInt(id)
            const chan = mng.getChannels().find( chan => chan.id === nId)
            if (!chan) {
                throw new Error('Failed to find channel by id: ' + id + ', tenant: ' + mng.getTenantId())
            }
            if (!context.canEditChannel(chan.identifier) || chan.tenantId !== context.getCurrentUser()?.tenantId) {
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to triger channel, tenant: ' + context.getCurrentUser()!.tenantId)
            }
            const channelMng = ChannelsManagerFactory.getInstance().getChannelsManager(context.getCurrentUser()!.tenantId)
            channelMng.triggerChannel(chan, language, data, context)
        },
        createChannel: async (parent: any, {identifier, name, order, group, active, type, valid, visible, config, mappings, runtime, parentId}: any, context: Context) => {
            context.checkAuth()
            if (!context.canEditConfig(ConfigAccess.CHANNELS)) 
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to create channel, tenant: ' + context.getCurrentUser()!.tenantId)

            if (!/^[A-Za-z0-9_]*$/.test(identifier)) throw new Error('Identifier must not has spaces and must be in English only: ' + identifier + ', tenant: ' + context.getCurrentUser()!.tenantId)

            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const tst = mng.getChannels().find( chan => chan.identifier === identifier)
            if (tst) {
                throw new Error('Identifier already exists: ' + identifier + ', tenant: ' + context.getCurrentUser()!.tenantId)
            }

            const val = valid ? valid.map((elem: string) => parseInt(elem)) : []
            const vis = visible ? visible.map((elem: string) => parseInt(elem)) : []
            const chan = await sequelize.transaction(async (t) => {
                const chan = await Channel.create ({
                    identifier: identifier,
                    tenantId: context.getCurrentUser()!.tenantId,
                    createdBy: context.getCurrentUser()!.login,
                    updatedBy: context.getCurrentUser()!.login,
                    name: name,
                    order: order != null ? order : null,
                    group: group,
                    active: active,
                    type: type,
                    valid: val,
                    visible: vis,
                    config: config ? config : {},
                    mappings: mappings ? mappings : {},
                    runtime: runtime ? runtime : {},
                    parentId: parentId != null ? parentId : 0,
                }, {transaction: t})
                return chan
            })

            mng.getChannels().push(chan)
            const channelMng = ChannelsManagerFactory.getInstance().getChannelsManager(context.getCurrentUser()!.tenantId)
            channelMng.startChannel(chan)
            await mng.reloadModelRemotely(chan.id, null, 'CHANNEL', false, context.getUserToken())
            return chan.id
        },
        updateChannel: async (parent: any, { id, name, order, group, active, type, valid, visible, config, mappings, runtime, parentId }: any, context: Context) => {
            context.checkAuth()
            if (!context.canEditConfig(ConfigAccess.CHANNELS)) 
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to update channel, tenant: ' + context.getCurrentUser()!.tenantId)

            const nId = parseInt(id)

            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            let chan  = mng.getChannels().find( (chan) => chan.id === nId)
            if (!chan) {
                throw new Error('Failed to find channel by id: ' + id + ', tenant: ' + mng.getTenantId())
            }

            if (name) chan.name = name
            if (order != null) chan.order = order
            if (group) chan.group = group
            if (active != null) chan.active = active
            if (type != null) chan.type = type
            if (valid) chan.valid = valid.map((elem: string) => parseInt(elem))
            if (visible) chan.visible = visible.map((elem: string) => parseInt(elem))
            if (config) {
                if (type === 2 && config.wbToken === '*****') { // WB
                    config.wbToken = chan.config.wbToken
                } else if (type === 3 && config.ozonApiKey === '*****') { // Ozon
                    config.ozonApiKey = chan.config.ozonApiKey
                }
                chan.config = config
            }
            if (parentId != null) chan.parentId = parentId
            const conflictedCategories: string[] = []
            if (mappings) {
                chan.mappings = updateChannelMappings(context, chan, mappings, conflictedCategories)
            }
            if (runtime) chan.runtime = runtime
            chan.updatedBy = context.getCurrentUser()!.login
            await sequelize.transaction(async (t) => {
                await chan!.save({ transaction: t })
            })

            const channelMng = ChannelsManagerFactory.getInstance().getChannelsManager(context.getCurrentUser()!.tenantId)
            if (chan.active) {
                channelMng.startChannel(chan)
            } else {
                channelMng.stopChannel(chan)
            }
            await mng.reloadModelRemotely(chan.id, null, 'CHANNEL', false, context.getUserToken())
            if (conflictedCategories.length > 0)
                throw new Error('The following categories could not be updated due to conflicts: ' + conflictedCategories.join(', '))

            return chan.id
        },
        removeChannel: async (parent: any, { id }: any, context: Context) => {
            context.checkAuth()
            if (!context.canEditConfig(ConfigAccess.CHANNELS)) 
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to remove channel, tenant: ' + context.getCurrentUser()!.tenantId)

            const nId = parseInt(id)

            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const idx = mng.getChannels().findIndex( (chan) => chan.id === nId)    
            if (idx === -1) {
                throw new Error('Failed to find channel by id: ' + id + ', tenant: ' + mng.getTenantId())
            }

            const chan  = mng.getChannels()[idx]
            chan.updatedBy = context.getCurrentUser()!.login
            // we have to change identifier during deletion to make possible that it will be possible to make new type with same identifier
            chan.identifier = chan.identifier + '_d_' + Date.now() 
            await sequelize.transaction(async (t) => {
                await chan!.save({transaction: t})
                await chan!.destroy({transaction: t})
            })

            mng.getChannels().splice(idx, 1)

            const channelMng = ChannelsManagerFactory.getInstance().getChannelsManager(context.getCurrentUser()!.tenantId)
            channelMng.stopChannel(chan)

            await mng.reloadModelRemotely(chan.id, null, 'CHANNEL', true, context.getUserToken())
            return true
        },
        bulkUpdateChannels: async (params: any, { identifiers, status, message, where }: any, context: Context) => {
            context.checkAuth()
            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            let whereObj = JSON.parse(where)
            const include = replaceOperations(whereObj)
            if (include && include.length > 0) {
                // update does not support include, so we have to change where to "select in" if we have include
                const search:any = {where: whereObj}
                search.include = include
                const items = await Item.applyScope(context).findAll(search)
                const ids = items.map(item => item.id)
                whereObj = {id: {[Op.in]: ids}}
            }
    
            const { newChannels, newWhere, result } = await processBulkUpdateChannelsActions(context, EventType.BeforeBulkUpdateChannels, identifiers, status, whereObj)

            identifiers = newChannels
            whereObj = newWhere

            // filter channels user has access
            identifiers = identifiers.filter((ident:any) => {
                const chan = mng.getChannels().find(chan => chan.identifier === ident)
                return context.canEditChannel(ident) && chan && chan.tenantId === context.getCurrentUser()?.tenantId
            })

            const chanRestrictSQL = identifiers.map((ident:any) => { // filter by type and path valid for channel
                const chan = mng.getChannels().find(chan => chan.identifier === ident)
                if (chan) {
                    const validArr = chan.valid.join(',')
                    let sql = ''
                    chan.visible.forEach((fromItem:any, idx:any, arr:any) => {
                        sql += "path ~ '*." + fromItem + ".*' "
                        if (idx != arr.length-1) sql += ' or '
                    })
                        return `("typeId" in (${validArr}) and (${sql}))`
                } else {
                    return ''
                }
            }).join(' and ')

            const andArr = [
                whereObj,
                literal(chanRestrictSQL)
            ]
            const restrictSql = await context.generateRestrictionsInSQL('', false) // filter by items user has access
            if (restrictSql.length > 0) andArr.push(literal(restrictSql))
            const andExpr = {[Op.and] : andArr}
            const secureWhereObj = andExpr

            let literalStr = ''

            if (status !== 0) {
                const param  = identifiers.map((identifier: any) => {
                    return `{ "${identifier}": { "status": ${status}, "submittedAt": ${Date.now()}, "submittedBy": "${context.getCurrentUser()!.login}", "message": "${message ? message : ''}" }}`;
                }).join("' || '")
                literalStr = `channels || '${param}'`
            } else {
                const param  = identifiers.join("' - '")
                literalStr = `channels - '${param}'`
            }

            await Item.update(
                {
                    channels: sequelize.literal(literalStr),
                },
                {
                    where: secureWhereObj
                }
            )

            await processBulkUpdateChannelsActions(context, EventType.AfterBulkUpdateChannels, identifiers, status, whereObj)
          
            return true
        }
    }
}