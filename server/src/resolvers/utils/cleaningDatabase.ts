import { sequelize } from "../../models"
import { scheduleJob, Job } from 'node-schedule'
import logger from "../../logger"
import { FileManager } from "../../media/FileManager"
import * as fs from 'fs'
import { User } from "../../models/users"
import { Process } from "../../models/processes"
import { StorageFactory } from "../../storage/StorageFactory"

export class cleaningDatabase {
    static scheduledJobs: any = {};

    static async RunJob(user: User): Promise<any> {
        logger.info('new DB cleaning job for user: ' + user.login+' -> '+JSON.stringify(user.props))
        const scheduledJob = this.scheduledJobs[user.login]
        if (scheduledJob) scheduledJob.cancel()
        this.scheduledJobs[user.login] = null

        if (!user.props.startClean) return

        if (process.env.OPENPIM_NO_CHANNEL_SCHEDULER === 'true') {
            logger.info(`   Skip cleaning job start because of OPENPIM_NO_CHANNEL_SCHEDULER=true`)
            return
        }

        const openpimDir : any = FileManager.getInstance().getFilesRoot()

        const daysToSaveDeleted = user.props.daysToSaveDeleted

        if (!daysToSaveDeleted) throw new Error('You must provide number of days to save the data')

        const newJob = scheduleJob(user.props.cron, async () => {
            let log = ''

            const proc = await Process.create({
                identifier: 'clean_' + user.login + '_' + Date.now(),
                tenantId: user.tenantId,
                createdBy: user.login,
                updatedBy: user.login,
                title: 'DB Cleanup Job ' + new Date(),
                active: true,
                status: 'running',
                log: '',
                runtime: {},
                finishTime: null,
                storagePath: '',
                mimeType: '',
                fileName: ''
            })

            let msg = 'DB cleaning was started at ' + new Date()
            log += msg + '\n'
            logger.info(msg)
        
            const queryAdd = ` and "deletedAt" < (now() - interval '`+daysToSaveDeleted+` day')`
            const queryAdd2 = ` and "updatedAt" < (now() - interval '`+daysToSaveDeleted+` day')`

            // attributes
            const attributes : any = await sequelize.query(`delete from "attributes" where "deletedAt" is not null`+queryAdd)
            msg = attributes[1].rowCount + ' attributes were deleted'
            log += msg + '\n'
            logger.info(msg)

            // item relations
            const itemRelations : any = await sequelize.query(`delete from "itemRelations" where "deletedAt" is not null`+queryAdd)
            msg = itemRelations[1].rowCount + ' item relations were deleted'
            log += msg + '\n'
            logger.info(msg)

            // items without files
            const items1 : any = await sequelize.query(`delete from "items" where "deletedAt" is not null and ("storagePath" is null or trim("storagePath") = '')`+queryAdd)
            msg = items1[1].rowCount + ' items without files were deleted'
            log += msg + '\n'
            logger.info(msg)

            // items with files
            const items2 : any = await sequelize.query(`select id, "storagePath" from "items" where "deletedAt" is not null and "storagePath" is not null`+queryAdd)
            msg = 'Found '+items2[1].rows.length+' items with files to delete'
            log += msg + '\n'
            logger.info(msg)
            const ids : any = []
            for (let i = 0; i < items2[1].rows.length; i++) {
                const item : any = items2[1].rows[i]
                if (item.storagePath === '') continue

                const file : any = openpimDir + item.storagePath
                if (fs.existsSync(file+'_thumb.jpg')) fs.unlinkSync(file+'_thumb.jpg')                

                const res = await StorageFactory.getStorageInstance().removeFile(item)
                if (!res) {
                    msg = 'Failed to find file, for item with id: ' + item.id
                    log += msg + '\n'
                    logger.info(msg)
                }
                ids.push(item.id)
            }

            for (let i = 0; i < ids.length; i++) {    
                const items3 : any = await sequelize.query(`delete from "items" where id = ` + ids[i])
            }
            msg = 'Items with files were deleted'
            log += msg + '\n'
            logger.info(msg)

            // channel executions without files
            const exec1 : any = await sequelize.query(`delete from "channels_exec" where ("storagePath" is null or trim("storagePath") = '')`+queryAdd2)
            msg = exec1[1].rowCount + ' channel executions without files were deleted'
            log += msg + '\n'
            logger.info(msg)

            // channel executions with files
            const exec2 : any = await sequelize.query(`select id, "storagePath" from "channels_exec" where "storagePath" is not null`+queryAdd2)
            msg = 'Found ' + exec2[1].rows.length+' channel executions with files to delete'
            log += msg + '\n'
            logger.info(msg)
            const execIds : any = []
            for (let i = 0; i < exec2[1].rows.length; i++) {
                const item = exec2[1].rows[i]
                if (item.storagePath === '') continue
                const file = openpimDir + item.storagePath
                if (fs.existsSync(file)) fs.unlinkSync(file)
                else {
                    msg = 'Failed to find file: ' + file
                    log += msg + '\n'
                    logger.info(msg)
                }
                execIds.push(item.id)
            }

            for (let i = 0; i < execIds.length; i++) {    
                const exec3 : any = await sequelize.query(`delete from "channels_exec" where id = ` + execIds[i])
            }
            msg = 'Channel executions with files were deleted'
            log += msg + '\n'
            logger.info(msg)

            // processes without files
            const proc1 : any = await sequelize.query(`delete from "processes" where ("storagePath" is null or trim("storagePath") = '')`+queryAdd2)
            msg = proc1[1].rowCount + ' processes without files were deleted'
            log += msg + '\n'
            logger.info(msg)

            // processes with files
            const proc2 : any = await sequelize.query(`select id, "storagePath" from "processes" where "storagePath" is not null`+queryAdd2)
            msg = 'Found '+ proc2[1].rows.length+' processes with files to delete'
            log += msg + '\n'
            logger.info(msg)
            const procIds = []
            for (let i = 0; i < proc2[1].rows.length; i++) {
                const item = proc2[1].rows[i]
                if (item.storagePath === '') continue
                const file = openpimDir + item.storagePath
                if (fs.existsSync(file)) fs.unlinkSync(file)
                else {
                    msg = 'Failed to find file: ' + file
                    log += msg + '\n'
                    logger.info(msg)
                }
                procIds.push(item.id)
            }

            for (let i = 0; i < procIds.length; i++) {    
                const proc3 : any = await sequelize.query(`delete from "processes" where id = ` + procIds[i])
            }
            msg = 'Processes with files were deleted'
            log += msg + '\n'
            logger.info(msg)

            msg = 'Cleanup job finished: ' + new Date()
            log += msg + '\n'
            logger.info(msg)

            proc.log = log
            proc.active = false
            proc.status = 'finished'
            proc.finishTime = new Date()
            await proc.save()            
        })
        this.scheduledJobs[user.login] = newJob
    }
}