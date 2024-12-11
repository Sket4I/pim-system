import Context, { ConfigAccess } from '../context'
import * as jwt from 'jsonwebtoken';
import { sequelize } from '../models'
import { User, Role } from '../models/users'
import { GraphQLError } from 'graphql';
import bcrypt from 'bcryptjs';
import { ModelManager, ModelsManager, UserWrapper } from '../models/manager';
import { Op, literal } from 'sequelize'
import { cleaningDatabase } from './utils/cleaningDatabase'

import logger from '../logger'
import audit from '../audit'
import { AttrGroup } from '../models/attributes';

export default {
    Query: {
        me: async (parent: any, args: any, context: Context) => { 
          context.checkAuth()
          return context.getUser()!.getUser()
        },
        getRoles: async (parent: any, args: any, context: Context) => {
            context.checkAuth()
            
            if (context.getCurrentUser()!.tenantId === '0') return [{id: 1, internalId: 1, identifier: 'admin', name: {}, configAccess: {"lovs": 2, "roles": 2, "types": 2, "users": 2, "actions": 2, "channels": 2, "languages": 2, "relations": 2, "attributes": 2, "dashboards": 2}, relAccess: {"access": 0, "groups": [], "relations": []}, itemAccess: {"valid": [], "access": 0, "groups": [], "fromItems": []}, otherAccess: {"audit": true, "search": true, "exportCSV": true, "exportXLS": true, "importXLS": true, "searchRelations": true, "exportRelationsXLS": true, "importRelationsXLS": true}, channelAccess: [], options: []}]

            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)
            return mng.getRoles()
        },
        getUsers: async (parent: any, args: any, context: Context) => {
            context.checkAuth()
            if (!context.canViewConfig(ConfigAccess.USERS)) return []
            
            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)
            return mng.getUsers().map(wrapper => wrapper.getUser())
        },
        hasLogin: async (parent: any, { login }: any, context: Context) => {
            context.checkAuth()
            if (!context.canViewConfig(ConfigAccess.USERS)) return true

            return (await User.findOne({where: {login: login}})) != null
        },
        getTenants: async (parent: any, { }: any, context: Context) => {
            context.checkAuth()
            if (context.getCurrentUser()!.tenantId != '0') {
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to query tenants, tenant: ' + context.getCurrentUser()!.tenantId)
            } else {
                return ModelsManager.getInstance().getTenants()
            }
        },
        getTenantUsers: async (parent: any, { tenantId }: any, context: Context) => {
            context.checkAuth()
            if (context.getCurrentUser()!.tenantId != '0') {
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to query tenant users, tenant: ' + context.getCurrentUser()!.tenantId)
            } else {
                return ModelsManager.getInstance().getModelManager(tenantId).getUsers().map(wrapper => wrapper.getUser())
            }
        }
    },
    Mutation: {
        createRole: async (parent: any, { identifier, name, configAccess, relAccess, itemAccess, channelAccess, otherAccess, options }: any, context: Context) => {
            context.checkAuth()
            if (!context.canEditConfig(ConfigAccess.ROLES)) 
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to create roles, tenant: ' + context.getCurrentUser()!.tenantId)

            if (!/^[A-Za-z0-9_-]*$/.test(identifier)) throw new Error('Identifier must not has spaces and must be in English only: ' + identifier + ', tenant: ' + context.getCurrentUser()!.tenantId)

            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const tst = mng.getRoles().find(role => role.identifier === identifier)
            if (tst) {
                throw new Error('Identifier already exists: ' + identifier + ', tenant: ' + context.getCurrentUser()!.tenantId)
            }

            const role = await sequelize.transaction(async (t) => {
                return await Role.create ({
                    identifier: identifier,
                    tenantId: context.getCurrentUser()!.tenantId,
                    createdBy: context.getCurrentUser()!.login,
                    updatedBy: context.getCurrentUser()!.login,
                    name: name || '',
                    configAccess: configAccess || { types: 0, attributes: 0, relations: 0, users: 0, roles: 0, languages: 0 },
                    relAccess: relAccess || { relations: [], access: 0, groups: [] },
                    itemAccess: itemAccess || { valid: [], fromItems: [], access: 0, groups: [] },
                    channelAccess: channelAccess || [],
                    otherAccess: otherAccess || { audit: false, search: false, exportXLS: false, exportCSV: false, importXLS: false, searchRelations: false, exportRelationsXLS: false, importRelationsXLS: false },
                    options: options ? options : []
                }, {transaction: t})
            })

            mng.getRoles().push(role);

            (<any>role).internalId = role.id
            
            await mng.reloadModelRemotely(role.id, null, 'ROLE', false, context.getUserToken())

            return role.id
        },
        updateRole: async (parent: any, { id, name, configAccess, relAccess, itemAccess, channelAccess, otherAccess, options }: any, context: Context) => {
            context.checkAuth()
            if (!context.canEditConfig(ConfigAccess.ROLES)) 
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to edit roles, tenant: ' + context.getCurrentUser()!.tenantId)

            const nId = parseInt(id)

            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const role  = mng.getRoles().find(role => role.id === nId)
            if (!role) {
                throw new Error('Failed to find role by id: ' + nId + ', tenant: ' + mng.getTenantId())
            }
            if (role.identifier === 'admin') {
                throw new Error('Administrator role can not be updated, tenant: ' + mng.getTenantId())
            }

            if (name) role.name = name
            if (configAccess) role.configAccess = configAccess
            if (relAccess) role.relAccess = relAccess
            if (itemAccess) role.itemAccess = itemAccess
            if (otherAccess) role.otherAccess = otherAccess
            if (channelAccess) role.channelAccess = channelAccess
            if (options != null) role.options = options
            role.updatedBy = context.getCurrentUser()!.login
            await sequelize.transaction(async (t) => {
                await role.save({transaction: t})
            })
            await mng.reloadModelRemotely(role.id, null, 'ROLE', false, context.getUserToken())
            return role.id
        },
        removeRole: async (parent: any, { id }: any, context: Context) => {
            context.checkAuth()
            if (!context.canEditConfig(ConfigAccess.ROLES)) 
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to delete roles, tenant: ' + context.getCurrentUser()!.tenantId)

            const nId = parseInt(id)

            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const idx = mng.getRoles().findIndex(role => role.id === nId)
            if (idx === -1) {
                throw new Error('Failed to find role by id: ' + nId + ', tenant: ' + mng.getTenantId())
            }

            const role  = mng.getRoles()[idx]
            if (role.identifier === 'admin') {
                throw new Error('Administrator role can not be deleted, tenant: ' + mng.getTenantId())
            }

            // check Users
            // const tst1 = await User.applyScope(context).findOne({where: {roles: { [Op.contains]: nId}}})
            const tst1 = await User.applyScope(context).findOne({where: literal("roles @> '"+nId+"'")})
            if (tst1) throw new Error('Can not remove this role because there are users linked to it.');

            role.updatedBy = context.getCurrentUser()!.login
            role.identifier = role.identifier + '_d_' + Date.now() 
            await sequelize.transaction(async (t) => {
                await role.save({transaction: t})
                await role.destroy({transaction: t})
            })

            mng.getRoles().splice(idx, 1)
            mng.getUsers().forEach(wrapper => {
                const idx = wrapper.getRoles().findIndex(data => data.id === role.id)
                if (idx !== -1) wrapper.getRoles().splice(idx, 1)
            })

            await mng.reloadModelRemotely(role.id, null, 'ROLE', true, context.getUserToken())

            return true
        },
        signIn: async (parent: any, { login, password }: any, context: Context) => {
            if (!password) {
                logger.error("Password was not provided for: " + login)
                throw new GraphQLError('Wrong login or password')
            }

            let where = { login: login } 
            if (ModelManager.getServerConfig()?.caseInsensitiveLogin) {
                where = { login: {[Op.iLike]: login }}
            }

            let user = await User.findOne({
                where: where
            });

            if (!user || user.password === '#external#') {
                // external auth
                const tst = await context.externalAuth(login, password)
                if (tst) {
                    // extrenal auth must return object {login: login, tenantId: 'default' , name: 'name', email: 'email', groups:['admin']}
                    if (!user) {
                        // create external user on the fly
                        const mng = ModelsManager.getInstance().getModelManager(tst.tenantId)
                        const userRoles = tst.groups ? tst.groups.map((grp:string) =>  mng.getRoles().find(elem => elem.identifier === grp)) : []
                        const roles:any = userRoles.map((grp:AttrGroup) =>  grp.id)
                        user= await sequelize.transaction(async (t) => {
                            const user = await User.create({
                                tenantId: tst.tenantId,
                                createdBy: tst.login,
                                updatedBy: '',
                                login: tst.login,
                                name: tst.name,
                                password: '#external#',
                                email: tst.email,
                                roles: roles,
                                props: {},
                                options: []
                              }, {transaction: t});
                            return user
                        })
                        mng.getUsers().push(new UserWrapper(user, userRoles))

                        // send token with id 1 (admin) because this user is not at remote server yet so checkAuth will fail without this
                        const token = await jwt.sign({
                            id: 1, 
                            tenantId: user.tenantId, 
                            login: user.login }, 
                            <string>process.env.SECRET, { expiresIn: 3 }
                        )
                        mng.reloadModelRemotely(user.id, null, 'USER', false, token)
                    }
                } else {
                    if (user) {
                        logger.error("Authentification failed for external user '" + login + "' with password '" + password + "'")
                        throw new GraphQLError('Wrong login or password')
                    } else {
                        logger.error("No user found for login: " + login)
                        throw new GraphQLError('Wrong login or password')
                    }
                }
            }

            if (user && (user.tenantId==='0' || ModelsManager.getInstance().getModelManager(user.tenantId))) {
                if ( user.password === '#external#' || await bcrypt.compare(password, user.password)) {
                    const tst = user.options.find((elem:any) => elem.name === 'expiresIn')
                    const expiresIn = tst ? tst.value : '1d'
                    const token = await jwt.sign({
                        id: user.id, 
                        tenantId: user.tenantId, 
                        login: user.login }, 
                        <string>process.env.SECRET, { expiresIn: expiresIn }
                    );            

                    (<any>user).internalId = user.id

                    logger.info("User " + login + " was logged on. Token: " + token)

                    return {token, user, auditEnabled: audit.auditEnabled()}
                } else {
                    logger.error("Authentification failed for user '" + login + "' with password '" + password + "'")
                    throw new GraphQLError('Wrong login or password')
                }                   
            } else {
                logger.error("No user found for login'" + login)
                throw new GraphQLError('Wrong login or password')
            }
        },
        signInAs: async (parent: any, { id }: any, context: Context) => {
            const nId = parseInt(id)

            context.checkAuth()
            if (context.getCurrentUser()!.tenantId != '0') {
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to sign in as, tenant: ' + context.getCurrentUser()!.tenantId)
            }

            const user = await User.findByPk(nId)

            if (user && ModelsManager.getInstance().getModelManager(user.tenantId)) {
                const tst = user.options.find((elem:any) => elem.name === 'expiresIn')
                const expiresIn = tst ? tst.value : '1d'
                const token = await jwt.sign({
                    id: user.id, 
                    tenantId: user.tenantId, 
                    login: user.login }, 
                    <string>process.env.SECRET, { expiresIn: expiresIn }
                );            

                (<any>user).internalId = user.id
                return {token, user, auditEnabled: audit.auditEnabled()}
            } else {
                throw new GraphQLError('No such user')
            }
        },        
        reloadModel: async (parent: any, { tenantId }: any, context: Context) => {
            context.checkAuth()
            if (context.getCurrentUser()!.tenantId != '0' && 
                (!context.isAdmin() || context.getCurrentUser()?.tenantId !== tenantId)) {
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to reload model for tenant: ' + tenantId + ', tenant: ' + context.getCurrentUser()!.tenantId)
            }

            logger.info('Reloading model for tenant: ' + tenantId + ' by user: ' + context.getCurrentUser()?.login)

            await ModelsManager.getInstance().reloadModel(tenantId)
            return true
        },        
        // hash for "test" - "$2b$10$LcF/gaMHx4V8dlKvKgjcvuTb./OQwzBZlIr18rO9sXQRp0JwiKt2a"
        // "admin" - "$2b$10$WtKEm5gspljprGVuHAj4QeO.QwzWiDmdEFN9VzXRbxyrSpQi9m4Fq"
        createUser: async (parent: any, { login, name, password, email, roles, props, options }: any, context: Context) => {
            context.checkAuth()
            if (!context.canEditConfig(ConfigAccess.USERS)) 
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to create user, tenant: ' + context.getCurrentUser()!.tenantId)

            if (!/^[@.A-Za-z0-9_]*$/.test(login)) throw new Error('Login must not has spaces and must be in English only: ' + login + ', tenant: ' + context.getCurrentUser()!.tenantId)

            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const tst = await User.findOne({where: {login: login}})
            if (tst) {
                throw new Error('Login already exists: ' + login + ', tenant: ' + context.getCurrentUser()!.tenantId)
            }

            const user= await sequelize.transaction(async (t) => {
                const user = await User.create({
                    tenantId: context.getCurrentUser()!.tenantId,
                    createdBy: context.getCurrentUser()!.login,
                    updatedBy: '',
                    login: login,
                    name: name,
                    password: await bcrypt.hash(password, 10),
                    email: email,
                    roles: roles || [],
                    props: props || {},
                    options: options ? options : []
                  }, {transaction: t});
                return user
            })

            const userRoles = user.roles ? user.roles.map((roleId: number) => mng!.getRoles().find(role => role.id === roleId)) : []
            mng.getUsers().push(new UserWrapper(user, userRoles));

            (<any>user).internalId = user.id

            await mng.reloadModelRemotely(user.id, null, 'USER', false, context.getUserToken())

            return user.id
        },
        updateUser: async (parent: any, { id, name, password, email, roles, props, options }: any, context: Context) => {
            context.checkAuth()
            const nId = parseInt(id)
            if (context.getCurrentUser()?.id !== nId && !context.canEditConfig(ConfigAccess.USERS)) 
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to update user, tenant: ' + context.getCurrentUser()!.tenantId)

            let user: User
            let wrapper: UserWrapper | undefined
            if (context.getCurrentUser()?.tenantId !== '0') { // normal user
                const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

                wrapper  = mng.getUsers().find(user => user.getUser().id === nId)
                if (!wrapper) {
                    throw new Error('Failed to find user by id: ' + nId + ', tenant: ' + mng.getTenantId())
                }

                user = wrapper.getUser()
            } else {
                const tst = await User.findByPk(nId) // super user
                user = tst!
            }

            if (name) user.name = name
            if (password && user.password !== '#external#') user.password = await bcrypt.hash(password, 10)
            if (email) user.email = email
            if (roles && context.getCurrentUser()?.id === nId && !context.canEditConfig(ConfigAccess.USERS)) roles = null
            if (roles && wrapper) {
                if (!context.canEditConfig(ConfigAccess.USERS)) 
                    throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to update roles at user, tenant: ' + context.getCurrentUser()!.tenantId)

                const adminRole = wrapper.getRoles().find(role => role.identifier === 'admin')

                user.roles = roles
                const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)
                const userRoles = user.roles ? user.roles.map((roleId: number) => mng!.getRoles().find(role => role.id === roleId)) : []

                if (adminRole) {
                    const tstRole = userRoles.find((role: Role) => role.identifier === 'admin')
                    if (!tstRole) {
                        // admin role was removed, need to check if we have more admins
                        // const tst = await User.findOne({where: {id: {[Op.ne]:nId}, roles: {[Op.contains]: adminRole.id}}})
                        const tst = await User.findOne({where: {[Op.and]: [{id: {[Op.ne]:nId}}, literal("roles @> '"+adminRole.id+"'")]}})
                        if (!tst) {
                            logger.error('Can not remove administrator role from last user, tenant: ' + context.getCurrentUser()!.tenantId)
                            throw new Error('Can not remove administrator role from last user who has it. Assign this role to another user first.')
                        }
                    }
                }

                wrapper.setRoles(userRoles)
            }
            if (props != null) user.props = props
            if (options != null) user.options = options
            user.updatedBy = context.getCurrentUser()!.login
            await sequelize.transaction(async (t) => {
                await user.save({transaction: t})
            })

            cleaningDatabase.RunJob(user)

            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)
            await mng.reloadModelRemotely(user.id, null, 'USER', false, context.getUserToken())

            return user.id
        },
        removeUser: async (parent: any, { id }: any, context: Context) => {
            context.checkAuth()
            if (!context.canEditConfig(ConfigAccess.USERS)) 
                throw new Error('User '+ context.getCurrentUser()?.id+ ' does not has permissions to remove user, tenant: ' + context.getCurrentUser()!.tenantId)

            const nId = parseInt(id)

            const mng = ModelsManager.getInstance().getModelManager(context.getCurrentUser()!.tenantId)

            const idx = mng.getUsers().findIndex(user => user.getUser().id === nId)
            if (idx === -1) {
                throw new Error('Failed to find user by id: ' + nId + ', tenant: ' + mng.getTenantId())
            }

            const wrapper = mng.getUsers()[idx]
            const adminRole = wrapper.getRoles().find(role => role.identifier === 'admin')
            if (adminRole) {
                // check that we has another user with admin role
                const tst = await User.findOne({where: {[Op.and]: [{id: {[Op.ne]:nId}}, literal("roles @> '"+adminRole.id+"'")]}})
                if (!tst) {
                    logger.error('Can not delete last user who has administrator role, tenant: ' + context.getCurrentUser()!.tenantId)
                    throw new Error('Can not remove administrator role from last user who has it. Assign this role to another user first.')
                }
            }

            const user  = wrapper.getUser()

            user.updatedBy = context.getCurrentUser()!.login
            user.login = user.login + '_d_' + Date.now() 
            await sequelize.transaction(async (t) => {
                await user.save({transaction: t})
                await user.destroy({transaction: t})
            })

            mng.getUsers().splice(idx, 1)

            await mng.reloadModelRemotely(user.id, null, 'USER', true, context.getUserToken())
            return true
        },    
    }
}