export default async function (obj) {
  if (parseInt(obj.typeId) === 22 || parseInt(obj.typeId) === 23) return true
  return false
}
