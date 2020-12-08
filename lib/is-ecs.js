'use strict'

module.exports = function () {
  return !!process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
}
