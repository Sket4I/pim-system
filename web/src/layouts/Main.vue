<template>
  <div>
    <ErrorBox />
    <v-navigation-drawer :width="drawerWidth" v-model="drawer" ref="drawerRef" :clipped="$vuetify.breakpoint.lgAndUp" app v-if="currentUserRef.tenantId !== '0'">
      <router-view style="height:90%; overflow-y: scroll; overflow-x: hidden;" name="menu"></router-view> <!-- тут изменения -->

      <v-bottom-navigation grow height="55" class="mt-2 mb-1" v-model="activeBottom" v-if="!isExportSearch">
        <v-btn to="/">
            <span>{{ $t('Main.Work') }}</span>
            <v-icon>mdi-home</v-icon>
        </v-btn>
        <v-btn to="/search" v-if="hasSearchAccess">
            <span>{{ $t('Main.Search') }}</span>
            <v-icon>mdi-magnify</v-icon>
        </v-btn>
        <v-btn to="/imports" v-if="hasImportsAccess && (importConfigCSVLicenceExist || importConfigYMLLicenceExist)">
            <span>{{ $t('Main.Imports') }}</span>
            <v-icon>mdi-file-outline</v-icon>
        </v-btn>
        <v-btn to="/channels" v-if="hasChannelsRef">
            <span>{{ $t('Main.Channels') }}</span>
            <v-icon>mdi-access-point</v-icon>
        </v-btn>
        <v-btn to="/config/home" v-if="hasConfigRef">
            <span>{{ $t('Main.Settings') }}</span>
            <v-icon>mdi-cog-outline</v-icon>
        </v-btn>
      </v-bottom-navigation>
    </v-navigation-drawer>

    <AppHeader :export="isExportSearch" :drawer="drawer" :drawerRight="drawerRight"/>

    <v-content>
      <v-container class="fill-height pa-2 ma-0 width:100%" fluid>
        <router-view :export="isExportSearch"></router-view>
      </v-container>
    </v-content>
    <v-dialog v-model="userDialogRef" persistent max-width="600px">
      <v-card v-if="currentUserRef">
        <v-card-title>
          <span class="headline">{{ $t('User.Details') }}</span>
        </v-card-title>
        <v-card-text>
          <v-container>
            <v-row>
              <v-col cols="12">
                <v-form ref="formRef" lazy-validation>
                  <v-text-field color="black" v-model="currentUserRef.login" disabled :label="$t('Config.Users.Login')" required></v-text-field>
                  <v-text-field color="black" v-model="currentUserRef.name" :label="$t('Config.Users.Name')" :rules="nameRules" required></v-text-field>
                  <v-text-field color="black" v-model="currentUserRef.email" :label="$t('Config.Users.Email')" required></v-text-field>

                  <template v-if="currentUserRef.external">
                    {{$t('Config.Users.External')}}
                  </template>
                  <template v-else>
                    <v-text-field color="black" v-if="currentUserRef.login !== 'demo'" type="password" :disabled="!getUserOption('passwordChange', true)" :error-messages="passwordErrors" v-model="currentUserRef.password1" :label="$t('Config.Users.Password1')" required></v-text-field>
                    <v-text-field color="black" v-if="currentUserRef.login !== 'demo'" type="password" :disabled="!getUserOption('passwordChange', true)" :error-messages="passwordErrors" v-model="currentUserRef.password2" :label="$t('Config.Users.Password2')" required></v-text-field>
                  </template>
                </v-form>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>
        <v-card-actions>
          <v-btn color="black" text @click="logout">{{ $t('Config.Users.Exit') }}</v-btn>
          <v-btn v-if="isUserAdmin" color="black" text @click="reload">{{ $t('Config.Users.ReloadModel') }}</v-btn>
          <v-spacer></v-spacer>
          <v-btn color="black" text @click="userDialogRef = false">{{ $t('Close') }}</v-btn>
          <v-btn color="black" text @click="save" v-if="currentUserRef.login !== 'demo'">{{ $t('Save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="logDialogRef" persistent width="90%">
      <v-card>
        <div class="text-center" v-if="!logRef" style="height: 200px; display: flex; align-items: center; justify-content: center;">
          <v-progress-circular :size="50" color="black" indeterminate></v-progress-circular>
        </div>
        <v-card-text v-else>
          <v-container>
            <v-row>
              <v-col cols="12">
                <v-textarea color="black" :rows="15" :readonly="true" v-model="logRef"></v-textarea>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="black" text v-if="logRef" @click="logDialogRef = false; logRef = null">{{ $t('Close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted } from '@vue/composition-api'
import ErrorBox from '../components/ErrorBox'
import AppHeader from '../components/AppHeader.vue'
import * as userStore from '../store/users'
import * as errorStore from '../store/error'
import * as channelsStore from '../store/channels'
import * as rolesStore from '../store/roles'
import * as dashStore from '../store/dashboards'
import * as procStore from '../store/processes'
import i18n from '../i18n'
import router from '../router'
import eventBus from '../eventBus'
import dateFormat from 'dateformat'

export default {
  components: { AppHeader, ErrorBox },
  props: {
    export: {
      type: Boolean,
      required: true
    }
  },
  setup (props) {
    const {
      showInfo
    } = errorStore.useStore()

    const {
      loadAllRoles
    } = rolesStore.useStore()

    const {
      currentUserRef,
      saveUser,
      canViewConfig,
      reloadModel,
      isAdmin,
      hasAccess
    } = userStore.useStore()

    const {
      channelTypes,
      loadAllChannelTypes,
      loadAllChannels
    } = channelsStore.useStore()

    const {
      loadAllDashboards,
      getDashboardsForCurrentUser
    } = dashStore.useStore()

    const {
      loadActiveProcesses,
      loadFinishedProcesses,
      loadProcessesByFilter
    } = procStore.useStore()

    const drawer = ref(null)
    const drawerRight = ref(false)
    const drawerRef = ref(null)
    const drawerWidth = ref(localStorage.getItem('drawerWidth') || '25%')
    const activeBottom = ref(0)
    const userDialogRef = ref(null)
    const passwordErrors = ref([])
    const formRef = ref(null)
    const hasConfigRef = ref(false)
    const hasChannelsRef = ref(false)

    const hasSearchAccess = ref(false)
    const hasImportsAccess = ref(false)
    const importConfigCSVLicenceExist = ref(false)
    const importConfigYMLLicenceExist = ref(false)
    const isUserAdmin = ref(false)

    const hasDashboards = ref(false)

    const activeProcesses = ref({ count: 0, rows: [] })
    const activeOptionsRef = ref({ page: 1, itemsPerPage: 5, sortBy: ['createdAt'], sortDesc: [true] })
    const activeLoadingRef = ref(false)
    const logDialogRef = ref(null)
    const logRef = ref(null)
    const finishedProcesses = ref({ count: 0, rows: [] })
    const finishedOptionsRef = ref({ page: 1, itemsPerPage: 5, sortBy: ['createdAt'], sortDesc: [true] })
    const finishedLoadingRef = ref(false)

    function reload () {
      reloadModel().then(() => logout())
    }

    function logout () {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      router.push(props.export ? '/export_login' : '/login')
      location.reload()
    }

    function save () {
      if (formRef.value.validate()) {
        if ((currentUserRef.value.password1 || currentUserRef.value.password2) && currentUserRef.value.password1 !== currentUserRef.value.password2) {
          passwordErrors.value = [i18n.t('Config.Users.Error.PasswordsNotEquals')]
          return
        }
        userDialogRef.value = false
        passwordErrors.value = []
        currentUserRef.value.props = { cron: currentUserRef.value.cron || '', daysToSaveDeleted: currentUserRef.value.daysToSaveDeleted ? parseInt(currentUserRef.value.daysToSaveDeleted) : -1, startClean: currentUserRef.value.startClean || false }
        saveUser(currentUserRef.value).then(() => {
          localStorage.setItem('user', JSON.stringify(currentUserRef.value))
          currentUserRef.value.password1 = ''
          currentUserRef.value.password2 = ''
          showInfo(i18n.t('Saved'))
        })
      }
    }

    function setBorderWidth () {
      if (!drawerRef.value) return
      const i = drawerRef.value.$el.querySelector(
        '.v-navigation-drawer__border'
      )
      i.style.width = '3px'
      i.style.cursor = 'ew-resize'
    }

    function setResizeEvents () {
      if (!drawerRef.value) return
      const el = drawerRef.value.$el
      const drawerBorder = el.querySelector('.v-navigation-drawer__border')
      const direction = el.classList.contains('v-navigation-drawer--right')
        ? 'right'
        : 'left'

      function resize (e) {
        if (e.screenX < 30) return

        document.body.style.cursor = 'ew-resize'
        const f = direction === 'right'
          ? document.body.scrollWidth - e.clientX
          : e.clientX
        el.style.width = f + 'px'
      }

      drawerBorder.addEventListener(
        'mousedown',
        function (e) {
          if (e.offsetX < 30) {
            el.style.transition = 'initial'; document.addEventListener('mousemove', resize, false)
          }
        },
        false
      )

      document.addEventListener(
        'mouseup',
        function () {
          el.style.transition = ''
          drawerWidth.value = el.style.width
          localStorage.setItem('drawerWidth', el.style.width)
          document.body.style.cursor = ''
          document.removeEventListener('mousemove', resize, false)
        },
        false
      )
    }

    async function activeOptionsUpdate (options) {
      activeLoadingRef.value = true
      const data = await loadActiveProcesses(options)
      activeProcesses.value = data
      activeLoadingRef.value = false
    }

    async function finishedOptionsUpdate (options) {
      finishedLoadingRef.value = true
      const data = await loadFinishedProcesses(options)
      finishedProcesses.value = data
      finishedLoadingRef.value = false
    }

    async function showLog (process) {
      try {
        const options = {
          page: 1,
          itemsPerPage: 1,
          sortBy: ['createdAt'],
          sortDesc: [true]
        }
        const where = { id: process.id }

        logDialogRef.value = true
        const result = await loadProcessesByFilter(options, where)
        logRef.value = result.rows[0]?.log || 'Лог отсутствует'
      } catch (error) {
        console.error('Ошибка загрузки логов:', error)
      }
    }

    const damUrl = window.location.href.indexOf('localhost') >= 0 ? process.env.VUE_APP_DAM_URL : window.OPENPIM_SERVER_URL + '/'
    const token = localStorage.getItem('token')
    let lastProcess
    async function checkFinishedProcesses () {
      const data = await loadFinishedProcesses({ page: 1, itemsPerPage: 1, sortBy: ['id'], sortDesc: [true] })
      if (data.count > 0) {
        if (lastProcess === undefined) {
          lastProcess = data.rows[0]
        } else if (lastProcess === null || lastProcess.id !== data.rows[0].id) {
          // new finished process found
          lastProcess = data.rows[0]
          const msg = lastProcess.storagePath
            ? i18n.t('Process.Finished2', { name: lastProcess.title, href: damUrl + 'asset-process/' + lastProcess.id + '?token=' + token, file: lastProcess.fileName || 'file.bin' })
            : i18n.t('Process.Finished1', { name: lastProcess.title })
          showInfo(msg)
          activeOptionsUpdate(activeOptionsRef.value)
          finishedOptionsUpdate(finishedOptionsRef.value)
        }
      } else if (lastProcess === undefined) {
        lastProcess = null
      }
    }

    let timer
    onMounted(() => {
      setBorderWidth()
      setResizeEvents()
      loadAllRoles().then(() => {
        timer = setInterval(checkFinishedProcesses, 60000)
        loadAllDashboards().then(() => {
          hasDashboards.value = getDashboardsForCurrentUser().length > 0
        })
        isUserAdmin.value = isAdmin()
        hasSearchAccess.value = hasAccess('search') || hasAccess('searchRelations')
        hasImportsAccess.value = hasAccess('imports')

        loadAllChannelTypes().then(() => {
          const importConfigCSVLicence = channelTypes.find(el => el === 1000)
          if (importConfigCSVLicence) {
            importConfigCSVLicenceExist.value = true
          }
          const importConfigYMLLicence = channelTypes.find(el => el === 1001)
          if (importConfigYMLLicence) {
            importConfigYMLLicenceExist.value = true
          }
        })

        if (currentUserRef.value.tenantId !== '0') {
          loadAllChannels().then(channels => {
            if (channels && channels.length > 0) hasChannelsRef.value = true
          })
          hasConfigRef.value = canViewConfig('types') || canViewConfig('attributes') || canViewConfig('relations') || canViewConfig('users') || canViewConfig('roles') || canViewConfig('languages') || canViewConfig('lovs') || canViewConfig('actions') || canViewConfig('dashboards') || canViewConfig('channels')
        }
      })

      eventBus.on('drawer_triggered', val => {
        drawer.value = val
      })

      eventBus.on('drawer_triggered_right', val => {
        drawerRight.value = val
      })

      eventBus.on('userDialogRef_triggered', val => {
        userDialogRef.value = val
      })
    })

    onUnmounted(() => {
      clearInterval(timer)
    })

    function getUserOption (name, defaultValue) {
      if (currentUserRef.value && currentUserRef.value.options) {
        const tst = currentUserRef.value.options.find(elem => elem.name === name)
        if (tst) return tst.value === 'true'
      }
      return defaultValue
    }

    return {
      logout,
      reload,
      drawer,
      drawerRight,
      drawerRef,
      drawerWidth,
      activeBottom,
      userDialogRef,
      currentUserRef,
      passwordErrors,
      save,
      formRef,
      hasConfigRef,
      hasChannelsRef,
      isExportSearch: props.export,
      hasSearchAccess,
      hasImportsAccess,
      importConfigCSVLicenceExist,
      importConfigYMLLicenceExist,
      isUserAdmin,
      hasDashboards,
      activeProcesses,
      activeOptionsRef,
      activeLoadingRef,
      activeOptionsUpdate,
      getUserOption,
      activeHeaders: [
        { text: i18n.t('Process.Header.Title'), value: 'title', width: '40%' },
        { text: i18n.t('Process.Header.Status'), value: 'status', width: '15%' },
        { text: i18n.t('Process.Header.Log'), value: 'log', sortable: false, width: '15%' },
        { text: i18n.t('Process.Header.File'), value: 'storagePath', width: '15%' },
        { text: i18n.t('Process.Header.StartedAt'), value: 'createdAt', width: '15%' }
      ],
      finishedProcesses,
      finishedOptionsRef,
      finishedLoadingRef,
      finishedOptionsUpdate,
      finishedHeaders: [
        { text: i18n.t('Process.Header.Title'), value: 'title', width: '25%' },
        { text: i18n.t('Process.Header.Status'), value: 'status', width: '15%' },
        { text: i18n.t('Process.Header.Log'), value: 'log', sortable: false, width: '15%' },
        { text: i18n.t('Process.Header.File'), value: 'storagePath', width: '15%' },
        { text: i18n.t('Process.Header.StartedAt'), value: 'createdAt', width: '15%' },
        { text: i18n.t('Process.Header.FinishedAt'), value: 'finishTime', width: '15%' }
      ],
      nameRules: [
        v => !!v || i18n.t('Config.Users.Error.NameRequired')
      ],
      dateFormat,
      DATE_FORMAT: process.env.VUE_APP_DATE_FORMAT,
      logDialogRef,
      logRef,
      showLog,
      damUrl: damUrl,
      token: token
    }
  }
}
</script>
<style>
.copyright-link, .copyright-link:visited, .copyright-link:hover, .copyright-link:active {
  color: gray;
  text-align: center;
  font-size:x-small;
}

  .truncate {
    max-width: 1px;
    overflow: hidden;
    border: thin solid rgba(0, 0, 0, 0.12);
  }

  .truncate > span {
    white-space: pre-wrap;
    text-overflow: ellipsis;
    overflow: hidden;
    display: -webkit-box;
    /* number of visible lines */
    -webkit-line-clamp: 10;
    -webkit-box-orient: vertical;
  }

  .zebra:nth-of-type(even) {
    background-color: #FCFCFC;
  }

.v-bottom-navigation {
  overflow-y: hidden;
  overflow-x: auto;
}
.container {
   margin: 0!important;
   max-width: 99%!important;
}
</style>
