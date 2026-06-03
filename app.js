(function(){var t=localStorage.getItem('tema');if(t&&t!=='azul')document.body.classList.add('theme-'+t);})();
'use strict';

const GOOGLE_CLIENT_ID = '563294598347-2sag5tsloqdrd9eh19kfnnc3nrc2gnja.apps.googleusercontent.com';
const DRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive.appdata profile email';
const AUTH_SCOPE       = 'profile email';
const SUPER_USER_EMAIL = 'guillermo.rc82@gmail.com';
const DRIVE_FILE_NAME  = 'horas-emt.json';
const HORAS_ANUALES    = 777;