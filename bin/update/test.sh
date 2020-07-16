IGNORE_LIST=$(cat ./.updateignore)

# echo $IGNORE
excludes=()
for toignore in $IGNORE_LIST; do
    excludes+=(--exclude "'$toignore'")
done

echo ${excludes[@]}