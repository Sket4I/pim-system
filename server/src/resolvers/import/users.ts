import Context from "../../context"
import { IImportConfig, ImportResponse, ReturnMessage, ImportResult, ImportMode, IUserImportRequest } from "../../models/import"
import { sequelize } from "../../models"
import { ModelsManager, ModelManager, AttrGroupWrapper, UserWrapper } from "../../models/manager"
import { User } from "../../models/users"
import bcrypt from 'bcryptjs';
import { Op, literal } from 'sequelize'

import logger from '../../logger'

export async function importUser(context: Context, config: IImportConfig, user: IUserImportRequest): Promise<ImportResponse> {
    const result = new ImportResponse(user.login)

    if (!user.login || !/^[@.A-Za-z0-9_]*$/.test(user.login)) {
        result.addError(ReturnMessage.WrongLogin)
        result.result = ImportResult.REJECTED
        return result
    }

    try {
        const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)
        const idx = mng.getUsers().findIndex(elem => elem.getUser().login === user.login)
        if (user.delete) {
            if (idx === -1) {
                result.addError(ReturnMessage.UserNotFound)
                result.result = ImportResult.REJECTED
            } else {
                const data = mng.getUsers()[idx].getUser()
                const wrapper = mng.getUsers()[idx]
                const adminRole = wrapper.getRoles().find(role => role.identifier === 'admin')
                if (adminRole) {
                    // check that we has another user with admin role
                    // const tst:User = await User.findOne({where: {id: {[Op.ne]:data.id}, roles: {[Op.contains]: adminRole.id}}})
                    const tst = await User.findOne({where: {[Op.and]:[{id: {[Op.ne]:data.id}}, literal("roles @> '"+adminRole.id+"'")]}})
                    if (!tst) {
                        result.addError(ReturnMessage.UserDeleteFailed)
                        result.result = ImportResult.REJECTED
                        return result
                    }
                }
    
                data.updatedBy = context.getCurrentUser()!.login
                data.login = data.login + '_d_' + Date.now() 
                await sequelize.transaction(async (t) => {
                    await data.save({transaction: t})
                    await data.destroy({transaction: t})
                })
    
                mng.getUsers().splice(idx, 1)
                await mng.reloadModelRemotely(data.id, null, 'USER', true, context.getUserToken())
                result.result = ImportResult.DELETED
            }
            return result
        }

        if (config.mode === ImportMode.CREATE_ONLY) {
            if (idx !== -1) {
                result.addError(ReturnMessage.UserExist)
                result.result = ImportResult.REJECTED
                return result
            }
        } else if (config.mode === ImportMode.UPDATE_ONLY) {
            if (idx === -1) {
                result.addError(ReturnMessage.UserNotFound)
                result.result = ImportResult.REJECTED
                return result
            }
        }        

        if (idx === -1) {
            // create
            const tst = await User.findOne({where: {login: user.login}})
            if (tst) {
                result.addError(ReturnMessage.UserExist)
                result.result = ImportResult.REJECTED
                return result
            }

            let roleIds = checkRoles(user.roles, mng, result)
            if (result.result) return result

            const data = await sequelize.transaction(async (t) => {
                return await User.create({
                    tenantId: context.getCurrentUser()!.tenantId,
                    createdBy: context.getCurrentUser()!.login,
                    updatedBy: '',
                    login: user.login,
                    name: user.name,
                    password: await bcrypt.hash("password", 10),
                    email: user.email,
                    roles: roleIds,
                    props: user.props || {},
                    options: user.options ?  user.options : []
                  }, {transaction: t});
            })

            const userRoles = roleIds.map((roleId: number) => mng!.getRoles().find(role => role.id === roleId)!)
            mng.getUsers().push(new UserWrapper(data, userRoles));

            result.id = ""+data.id
            await mng.reloadModelRemotely(data.id, null, 'USER', false, context.getUserToken())
            result.result = ImportResult.CREATED
        } else {
            // update
            const wrapper = mng.getUsers()[idx]
            const data = wrapper.getUser()

            if (user.name) data.name = user.name
            if (user.email) data.email = user.email
            if (user.props) data.props = user.props

            if (user.roles) {
                let roleIds = checkRoles(user.roles, mng, result)
                if (result.result) return result
                data.roles = roleIds

                const userRoles = roleIds.map((roleId: number) => mng!.getRoles().find(role => role.id === roleId)!)
                wrapper.setRoles(userRoles)
            }

            if (user.options != null) data.options = user.options
            data.updatedBy = context.getCurrentUser()!.login
            await sequelize.transaction(async (t) => {
                await data.save({transaction: t})
            })

            result.id = ""+data.id
            await mng.reloadModelRemotely(data.id, null, 'USER', false, context.getUserToken())
            result.result = ImportResult.UPDATED
        } 
    } catch (error) {
        result.addError(new ReturnMessage(0, ""+error))
        result.result = ImportResult.REJECTED
        logger.error(error)
    }

    return result
}

function checkRoles(roles: [string], mng: ModelManager, result: ImportResponse) {
    let res: number[] = []
    if (roles) {
        for (let index = 0; index < roles.length; index++) {
            const roleIdentifier = roles[index];
            const tst = mng.getRoles().find(elem => elem.identifier === roleIdentifier)
            if (!tst) {
                result.addError(ReturnMessage.RoleNotFound)
                result.result = ImportResult.REJECTED
                return <number[]>[]
            }
            res.push(tst.id)
        }
    }
    return res
}

