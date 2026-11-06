(function(){
  'use strict';
  window.FUSION = window.FUSION || {};
  var $ = function(id){ return document.getElementById(id); };

  function send(url, body){
    return fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify(body) }).then(function(response){
      return response.json().then(function(data){
        return { ok:response.ok, error:data.error };
      });
    }).catch(function(){ return { ok:false, error:'Could not reach the server. Try again.' }; });
  }

  var ownForm = $('passwordForm');
  if(ownForm){
    ownForm.addEventListener('submit', function(event){
      event.preventDefault();
      var button = $('passwordSave'), note = $('passwordSay');
      if(button.disabled) return;
      note.textContent = '';
      if($('passwordNew').value !== $('passwordConfirm').value){
        note.textContent = 'The new passwords do not match.';
        $('passwordConfirm').focus(); return;
      }
      button.disabled = true;
      send('/api/me/password', {
        currentPassword:$('passwordCurrent').value,
        newPassword:$('passwordNew').value,
        confirmPassword:$('passwordConfirm').value
      }).then(function(result){
        button.disabled = false;
        note.textContent = result.ok ? 'Password changed.' : (result.error || 'Could not change the password.');
        if(result.ok) ownForm.reset();
      });
    });
  }

  var dialog = $('passwordResetDialog'), target = null;
  if(dialog){
    window.FUSION.openPasswordReset = function(person){
      $('passwordResetForm').reset();
      $('passwordResetSay').textContent = '';
      target = person.sub;
      $('passwordResetWho').textContent = 'User ID: ' + person.loginId;
      dialog.showModal();
    };
    $('passwordResetCancel').addEventListener('click', function(){ dialog.close(); });
    dialog.addEventListener('close', function(){
      $('passwordResetForm').reset(); target = null;
    });
    $('passwordResetForm').addEventListener('submit', function(event){
      event.preventDefault();
      var button = $('passwordResetSave'), note = $('passwordResetSay');
      if(button.disabled || !target) return;
      note.textContent = '';
      if($('passwordResetNew').value !== $('passwordResetConfirm').value){
        note.textContent = 'The new passwords do not match.';
        $('passwordResetConfirm').focus(); return;
      }
      button.disabled = true;
      send('/api/portal/people/password', { sub:target,
        password:$('passwordResetNew').value,
        confirmPassword:$('passwordResetConfirm').value
      }).then(function(result){
        button.disabled = false;
        note.textContent = result.ok
          ? 'Password reset. Share the new password privately; the user can change it in their profile.'
          : (result.error || 'Could not reset the password.');
        if(result.ok){ $('passwordResetForm').reset(); target = null; }
      });
    });
  }
})();
