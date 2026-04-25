#!/usr/bin/env bash
set -euo pipefail

DISK="${1:-}"
SHARE_SIZE="${2:-70%}"
SHARE_NAME="${3:-SHARE_EXFAT}"
APFS_NAME="${4:-MAC_APPS_APFS}"

if [[ -z "${DISK}" ]]; then
  echo "Usage: sudo $0 disk4 [70%|200G] [SHARE_EXFAT] [MAC_APPS_APFS]"
  echo
  echo "Find the disk identifier first:"
  echo "  diskutil list"
  exit 1
fi

if [[ "${DISK}" != /dev/* ]]; then
  DISK="/dev/${DISK}"
fi

DISK_NAME="$(basename "${DISK}")"

echo "This will erase and repartition: ${DISK}"
diskutil list "${DISK}"

echo
echo "Partition layout:"
echo "  1. ${SHARE_NAME}  ExFAT  size=${SHARE_SIZE}"
echo "  2. ${APFS_NAME}   APFS   remaining space"
echo
read -r -p "Type ERASE-${DISK_NAME} to continue: " CONFIRM

if [[ "${CONFIRM}" != "ERASE-${DISK_NAME}" ]]; then
  echo "Cancelled."
  exit 1
fi

diskutil unmountDisk force "${DISK}"

diskutil partitionDisk "${DISK}" GPT \
  ExFAT "${SHARE_NAME}" "${SHARE_SIZE}" \
  APFS "${APFS_NAME}" 0b

echo
echo "Done. Current layout:"
diskutil list "${DISK}"
