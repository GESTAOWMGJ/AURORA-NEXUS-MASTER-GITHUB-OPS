package main
import("archive/zip";"bytes";"os";"path/filepath";"testing")
func archiveFor(names []string) []byte {var b bytes.Buffer;z:=zip.NewWriter(&b);for _,n:=range names{w,_:=z.Create(n);w.Write([]byte("fixture"))};z.Close();return b.Bytes()}
func TestCompletePayload(t *testing.T){root:=t.TempDir();if err:=extract(archiveFor(required),root);err!=nil{t.Fatal(err)};for _,name:=range required{if _,err:=os.Stat(filepath.Join(root,filepath.FromSlash(name)));err!=nil{t.Fatal(err)}}}
func TestMissingAndDuplicateFiles(t *testing.T){for _,names:=range [][]string{required[:1],append(append([]string{},required...),required[0])}{if extract(archiveFor(names),t.TempDir())==nil{t.Fatal("invalid payload accepted")}}}
func TestNeverOverwrite(t *testing.T){root:=t.TempDir();data:=archiveFor(required);if err:=extract(data,root);err!=nil{t.Fatal(err)};if extract(data,root)==nil{t.Fatal("overwrite accepted")}}
func TestIgnoreTraversal(t *testing.T){root:=t.TempDir();if err:=extract(archiveFor(append(append([]string{},required...),"../outside")),root);err!=nil{t.Fatal(err)};if _,err:=os.Stat(filepath.Join(root,"..","outside"));!os.IsNotExist(err){t.Fatal("path escaped")}}
