<template>
  <div v-if="true">
    <v-tooltip top>
      <template v-slot:activator="{ on }">
        <v-btn v-on="on" icon @click="showDialog()"><v-icon>mdi-account-box-outline</v-icon></v-btn>
      </template>
      <span>{{ 'Для подборки' }}</span>
    </v-tooltip>
    <v-dialog v-model="selectionDialogRef" persistent width="70%">
      <v-card>
        <v-card-title>
          <span class="headline">{{ $t('Items.SelectionDialog.Title') }}</span>
        </v-card-title>
        <v-card-text>
          <v-container class="pa-0">
            <v-row>
              <v-col cols="12" class="pa-0 overflow-y-auto" style="max-height: 70vh">
                <v-tabs color="black" v-model="tabRef">
                  <v-tab v-text="$t('Items.SelectionDialog.Selection')"></v-tab>
                  <v-tab v-text="$t('Items.SelectionDialog.Search')"></v-tab>
                </v-tabs>
                <v-tabs-items v-model="tabRef">
                  <v-tab-item> <!-- tree -->
                    <v-treeview color="black" v-if="selectionDialogRef" dense selectable selection-type="independent" hoverable
                      :items="treeRef" :load-children="loadChildren" v-model="selectedItemsRef" @input="onSelect" open-all>
                      <template v-slot:prepend="{ item }">
                        <v-icon v-if="item.typeIcon" :color="item.typeIconColor">mdi-{{ item.typeIcon }}</v-icon>
                      </template>
                      <template v-slot:label="{ item }">
                        {{ item.name[currentLanguage.identifier] || '[' + item.name[defaultLanguageIdentifier] + ']' }}
                      </template>
                    </v-treeview>
                  </v-tab-item>
                  <v-tab-item> <!-- search -->
                    <v-text-field color="black" @keydown.enter.prevent="searchEnterPressed" v-model="searchTextRef"
                      @input="searchChanged" :label="$t('Search')" append-icon="mdi-magnify"
                      class="ml-5 mr-5"></v-text-field>
                    <v-list dense v-if="searchResultsRef && searchResultsRef.length > 0">
                      <v-list-item-group v-model="searchSelectedRef" color="black">
                        <v-list-item v-for="(elem, i) in searchResultsRef" :key="i" dense>
                          <v-list-item-content>
                            <v-list-item-title><a @click="selectItem(i)">{{ elem.identifier + ' ('
                              + elem.type.identifier + ')' }}</a></v-list-item-title>
                            <v-list-item-subtitle>{{ elem.name[currentLanguage.identifier] || '[' +
                              elem.name[defaultLanguageIdentifier] + ']' }}</v-list-item-subtitle>
                          </v-list-item-content>
                        </v-list-item>
                      </v-list-item-group>
                    </v-list>
                  </v-tab-item>
                </v-tabs-items>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="black" text @click="selectionDialogRef = false">{{ $t('Cancel') }}</v-btn>
          <v-btn color="black" text @click="selected">{{ $t('Select') }}</v-btn>
        </v-card-actions>
      </v-card>
  </v-dialog>
</div></template>
<script>
import router from '../../../router'
import { ref, computed } from '@vue/composition-api'
import * as itemStore from '../../../store/item'
import * as langStore from '../../../store/languages'
import * as searchStore from '../../../store/search'
import * as errorStore from '../../../store/error'
import { serverFetch } from '../../../store/utils'

export default {
  props: {
    headers: {
      required: true
    },
    columnsSelected: {
      required: true
    },
    items: {
      required: true
    },
    loadData: {
      required: true
    },
    processButtonAction: {
      required: true
    },
    whereFunc: {
      required: false
    }
  },
  setup (props) {
    const {
      itemsTree,
      loadItems,
      searchItem,
      findItem
    } = itemStore.useStore()

    const {
      currentLanguage,
      defaultLanguageIdentifier
    } = langStore.useStore()

    const {
      save,
      currentFilterRef
    } = searchStore.useStore()

    const { showInfo } = errorStore.useStore()

    const currentRoute = ref(null)

    router.afterEach((to, from) => {
      currentRoute.value = to.params.id
    })

    const tabRef = ref(null)
    const selectedItemsRef = ref([])
    const selectionDialogRef = ref(false)
    const searchTextRef = ref('')
    const searchSelectedRef = ref(null)
    const searchResultsRef = ref([])
    let awaitingSearch = null

    const currentTrend = ref(null)

    function searchChanged () {
      if (searchTextRef.value.length > 1) {
        if (awaitingSearch) {
          clearTimeout(awaitingSearch)
          awaitingSearch = null
        }
        if (!awaitingSearch) {
          awaitingSearch = setTimeout(() => {
            performSearch()
          }, 1000)
        }
      }
    }

    function searchEnterPressed () {
      if (awaitingSearch) {
        clearTimeout(awaitingSearch)
      }
      performSearch()
    }

    function performSearch () {
      const typesExpr = '{typeIdentifier: "trend"}'
      searchItem(searchTextRef.value, typesExpr).then(data => {
        searchResultsRef.value = data.rows
      })
    }

    function selectItem (idx) {
      searchSelectedRef.value = idx
      selected()
    }

    async function selected () {
      if (selectedItemsRef.value[0]) {
        const id = selectedItemsRef.value[0]
        const node = findItem(id).node
        currentTrend.value = node.internalId
      } else if (searchSelectedRef.value != null) {
        currentTrend.value = searchResultsRef.value[searchSelectedRef.value].id
      }
      selectionDialogRef.value = false
      const trend = findItem(currentTrend.value)
      const trendIdentifier = currentRoute.value ? currentRoute.value : `trend_${Date.now()}`
      const trendName = {
        ru: `Подборка (${trend.node.name.ru})`
      }
      const extended = currentFilterRef.value ? 'false' : 'true'
      const filters = currentFilterRef.value ? currentFilterRef.value : []
      const search = {
        identifier: trendIdentifier,
        name: trendName,
        entity: 'ITEM',
        public: 'true',
        extended: extended,
        filters: filters,
        whereClause: props.whereFunc()
      }
      const itemIdentifier = trend.node.identifier
      const itemQueryName = trendName.ru
      const itemURI = `https://pim.poisondrop.ru/#/search/${trendIdentifier}`
      const item = {
        identifier: itemIdentifier,
        values: {
          trendQuery: itemURI,
          trendQuery_text: itemQueryName
        }
      }
      save(search).then(() => {
        if (!currentRoute.value) router.push('/search/' + trendIdentifier)
      })
      const data = await serverFetch(`mutation { import(
      config: {
          mode: CREATE_UPDATE
          errors: PROCESS_WARN
      },
      items: [
          {
              identifier: ${JSON.stringify(item.identifier)},
              values: ${JSON.stringify(item.values).replace(/"([^"]+)":/g, '$1:')}
          }]
      ) {
      items {
        identifier
        result
        id
        errors { code message }
        warnings { code message }
      }}}`)
      console.log(data)
      showInfo('Готово')
      selectedItemsRef.value[0] = null
    }

    function showDialog () {
      if (itemsTree.length === 0) {
        loadItems().then(() => {
          treeRef.value = itemsTreeFiltered.value
          selectionDialogRef.value = true
        })
      } else {
        treeRef.value = itemsTreeFiltered.value
        selectionDialogRef.value = true
      }
    }

    function onSelect (arr) {
      if (arr && arr.length > 1) {
        const val = arr[arr.length - 1]
        selectedItemsRef.value = [val]
      }
    }

    async function loadChildren (item) {
      await loadItems(item.id, item.internalId, item.typeId)
      treeRef.value = itemsTreeFiltered.value
    }

    const treeRef = ref([])

    const itemsTreeFiltered = computed(() => {
      return itemsTree.filter(item => {
        if (item.typeIdentifier === 'trends') return true
      })
    })

    return {
      itemsTreeFiltered,
      loadChildren,
      selectionDialogRef,
      selected,
      selectItem,
      selectedItemsRef,
      onSelect,
      showDialog,
      currentLanguage,
      defaultLanguageIdentifier,
      tabRef,
      searchTextRef,
      searchSelectedRef,
      searchResultsRef,
      searchChanged,
      searchEnterPressed,
      treeRef
    }
  }
}
</script>
