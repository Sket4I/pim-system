<template>
  <div>
    <template v-if="item.typeIdentifier === 'trend'">
          <v-btn text @click="dialogRef = true">Редактировать товары</v-btn>
    </template>
  <v-dialog v-model="dialogRef" persistent width="60%">
    <v-card>
      <v-card-title>
        <div>
          Введите коды
        </div>
      </v-card-title>
      <v-card-text>
        <v-container>
          <v-radio-group v-model="createItem">
            <v-radio color="black" label="Добавить товары" :value="true"></v-radio>
            <v-radio color="black" label="Удалить товары" :value="false"></v-radio>
          </v-radio-group>
          <v-checkbox :disabled="!createItem" label="Удалить все товары перед загрузкой" v-model="deletedAllcodes"></v-checkbox>
        </v-container>
        <v-container>
          <v-row>
            <v-col cols="12">
              <v-textarea color="black" :rows="5" v-model="codes"></v-textarea>
            </v-col>
          </v-row>
        </v-container>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="black" text @click="dialogRef = false">{{ $t('Cancel') }}</v-btn>
        <v-btn color="black" text @click="executeButtonAction" :disabled="!codes || codes.length === 0">{{ $t('Execute') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</div>
</template>
<script>
import { ref, watch } from '@vue/composition-api'
import * as actionsStore from '../../../store/actions'
import * as errorStore from '../../../store/error'

export default {
  props: {
    item: {
      required: true
    }
  },
  setup (props) {
    const { executeActionByIdentifier } = actionsStore.useStore()
    const { showInfo } = errorStore.useStore()

    const dialogRef = ref(false)
    const codes = ref(null)
    const createItem = ref(true)
    const deletedAllcodes = ref(false)

    function executeButtonAction () {
      if (createItem.value) {
        if (deletedAllcodes.value && confirm('Вы уверены, что хотите удалить все товары из подборки?')) {
          executeActionByIdentifier(props.item.id, 'itemRelationForTrends', JSON.stringify([codes.value.split('\n'), deletedAllcodes.value]))
          showInfo('Программа запущена. Вы можете следить за ней в закладке процессы')
          dialogRef.value = false
        } else {
          executeActionByIdentifier(props.item.id, 'itemRelationForTrends', JSON.stringify([codes.value.split('\n'), deletedAllcodes.value]))
          showInfo('Программа запущена. Вы можете следить за ней в закладке процессы')
          dialogRef.value = false
        }
      } else {
        if (confirm('Вы уверены, что хотите удалить данные товары из подборки?')) {
          executeActionByIdentifier(props.item.id, 'deleteItemRelationForTrends', JSON.stringify(codes.value.split('\n')))
          showInfo('Программа запущена. Вы можете следить за ней в закладке процессы')
          dialogRef.value = false
        }
      }
    }

    watch(() => createItem.value, (newValue, prevValue) => {
      if (!newValue) {
        deletedAllcodes.value = false
      }
    })

    return {
      executeButtonAction,
      dialogRef,
      codes,
      createItem,
      deletedAllcodes
    }
  }
}
</script>

<style scoped>
.v-input--selection-controls {
  margin-top: 0px;
  padding-top: 0px;
}
.col-12, .v-input {
  padding-top: 0px;
}
</style>
