import re

with open('src/browser.html', 'r') as f:
    code = f.read()

# Find the exact text to target: the bank delay block end + start of custom bank domains section
target = '''        inp.addEventListener("change",function(){var v=inp.value;sv("bankDelaySec",v);toast("Bank security delay set to "+v+" seconds");});
      })();'''

insert = '''      // Custom bank domains
      (function(){
        var inp=$("s-custombank");if(!inp)return;
        var addBtn=$("s-addbankdomain");if(!addBtn)return;
        var list=$("custombank-list");if(!list)return;
        function renderList(){
          var customs=settings.customBankDomains||[];
          list.innerHTML="";
          customs.forEach(function(d,i){
            var div=document.createElement("div");
            div.style.cssText="display:flex;align-items:center;gap:8px;background:var(--c-surface);border:1px solid var(--c-border);border-radius:6px;padding:6px 10px;margin-top:4px;";
            div.innerHTML='<span style="flex:1;color:var(--k-text);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(d)+'</div>'+
              '<button class="btn-sm btn-danger" style="padding:4px 10px;font-size:12px" data-dom="'+esc(d)+'">Remove</button>';
            div.querySelector("button").addEventListener("click",function(){
              var dom=d;
              var customs=settings.customBankDomains||[];
              var idx=customs.indexOf(dom);
              if(idx>=0){customs.splice(idx,1);sv("customBankDomains",customs);renderList();toast("Removed "+dom);}
            });
            list.appendChild(div);
          });
        }
        addBtn.addEventListener("click",function(){
          var v=inp.value.trim().toLowerCase();
          if(!v){toast("Enter a domain");return;}
          var customs=settings.customBankDomains||[];
          if(customs.includes(v)){toast("Already added");return;}
          customs.push(v);
          sv("customBankDomains",customs);
          inp.value="";
          renderList();
          toast("Added "+v);
        });
        renderList();
      })();'''

if target in code:
    code = code.replace(target, target + '\n' + insert)
    with open('src/browser.html', 'w') as f:
        f.write(code)
    print("Successfully added custom bank domains UI bindings")
else:
    print("Target not found")
    # Show context around where we expect it
    lines = code.split('\n')
    for i in range(5570, 5580):
        print(f"{i+1}: {repr(lines[i])}")
