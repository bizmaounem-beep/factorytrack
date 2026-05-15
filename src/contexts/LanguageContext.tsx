import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'fr';

interface Translation {
  [key: string]: {
    fr: string;
  };
}

export const translations: Translation = {
  // General
  dashboard: { fr: 'Tableau de Bord' },
  history: { fr: 'Historique' },
  monitor: { fr: 'Surveillance' },
  logout: { fr: 'Déconnexion' },
  admin: { fr: 'Administration' },
  operator: { fr: 'Opérateur' },
  pilot: { fr: 'Pilote' },
  settings: { fr: 'Paramètres' },
  save: { fr: 'Sauvegarder' },
  cancel: { fr: 'Annuler' },
  delete: { fr: 'Supprimer' },
  edit: { fr: 'Modifier' },
  add: { fr: 'Ajouter' },
  new: { fr: 'Nouveau' },
  
  user: { fr: 'Utilisateur' },
  machine: { fr: 'Machine' },
  line: { fr: 'Ligne' },
  program: { fr: 'Programme' },
  shift: { fr: 'Équipe (Shift)' },
  shifts: { fr: 'Équipes' },
  shift_name: { fr: 'Nom de l\'équipe' },
  select_shift: { fr: 'Sélectionner Équipe' },
  choose_current_shift: { fr: 'Choisir votre équipe actuelle' },
  
  describe_reason: { fr: 'Veuillez décrire le motif' },
  back: { fr: 'Retour' },
  
  // Pilot Screen
  machine_select: { fr: 'Sélectionner Machine' },
  line_select: { fr: 'Sélectionner Ligne' },
  assign_programme: { fr: 'Assigner Programme' },
  active_line: { fr: 'Ligne Active' },
  inactive_line: { fr: 'Ligne Inactive' },
  out_of_service: { fr: 'Hors Service' },
  production_log: { fr: 'Log de Production' },
  downtime_log: { fr: 'Log des Arrêts' },
  status_machine: { fr: 'Status Machine' },
  change: { fr: 'Changer' },
  stop_machine: { fr: 'Arrêt Machine' },
  start_machine: { fr: 'Lancer Machine' },
  new_programme: { fr: 'Nouveau Programme' },
  prog_name_placeholder: { fr: 'Nom du programme...' },
  technical_params: { fr: 'Paramètres Techniques' },
  params_placeholder: { fr: 'Vitesse, Pression, etc...' },
  save_assign: { fr: 'Sauvegarder & Assigner' },
  choose_active_prog: { fr: 'Choisir parmi les programmes actifs' },
  prog_ready: { fr: 'Programme prêt' },
  no_prog_available: { fr: 'Aucun autre programme disponible.' },
  confirm_delete_title: { fr: 'Supprimer ?' },
  confirm_delete_msg: { fr: 'Voulez-vous supprimer cet enregistrement ?' },
  correct: { fr: 'Corriger' },
  manual_entry: { fr: 'Enregistrement manuel' },
  quantity: { fr: 'Quantité' },
  start_time: { fr: 'Début' },
  end_time: { fr: 'Fin' },
  reason: { fr: 'Motif' },
  deactivate: { fr: 'Désactiver' },
  activate: { fr: 'Activer' },
  quantity_short: { fr: 'Qté' },
  time_short: { fr: 'Moment' },
  
  // Operator Screen
  start: { fr: 'Démarrer' },
  stop: { fr: 'Arrêter' },
  running: { fr: 'En cours' },
  stopped: { fr: 'Arrêté' },
  idle: { fr: 'En attente' },
  pallets: { fr: 'Palettes' },
  register_production: { fr: 'Enregistrer Production' },
  declare_downtime: { fr: 'Déclarer Arrêt' },
  active_prod_label: { fr: 'Production Active' },
  waiting_label: { fr: 'En Attente' },
  stop_prod: { fr: 'Arrêt Prod' },
  start_prod: { fr: 'Démarrer Production' },
  finish_mission: { fr: 'Terminer & Clôturer Mission' },
  stop_prod_caution: { fr: 'Machine en arrêt : Saisie possible' },
  qualify_stop: { fr: 'Qualifier l\'Arrêt' },
  indicate_cause: { fr: 'Indiquer la cause' },
  manual_add: { fr: 'Ajout manuel' },
  waiting_start: { fr: 'En attente lancement' },
  waiting_start_desc: { fr: 'En attente de démarrage' },
  manage_stops: { fr: 'Gestion Arrêts' },
  error_change_prog: { fr: 'Erreur ? Changer le programme' },
  current_prog: { fr: 'Programme Actuel' },
  no_programme: { fr: 'Aucun programme' },
  production_label_short: { fr: 'PROD' },
  stop_label_short: { fr: 'ARRÊT' },
  wait_label_short: { fr: 'ATTENTE' },
  details: { fr: 'Détails' },
  choose_target_prog: { fr: 'Choisir programme cible' },
  out: { fr: 'QUITTER' },
  
  // Admin Panel
  users: { fr: 'Utilisateurs' },
  machines: { fr: 'Machines' },
  lines: { fr: 'Lignes' },
  programmes: { fr: 'Programmes' },
  active_programmes: { fr: 'Programmes en Cours' },
  finished_programmes: { fr: 'Programmes Clôturés' },
  downtime_types: { fr: 'Types d\'Arrêt' },
  pallets_per_day: { fr: 'Palettes / Jour' },
  active_lines: { fr: 'Lignes Actives' },
  ongoing_stops: { fr: 'Arrêts en cours' },
  total_staff: { fr: 'Effectif total' },
  live_monitor: { fr: 'Monitor de Production Live' },
  add_user: { fr: 'Ajouter Utilisateur' },
  add_machine: { fr: 'Ajouter Machine' },
  free: { fr: 'Libre' },
  release: { fr: 'Libérer' },
  parc_machine: { fr: 'Parc Machine' },
  connected: { fr: 'Connecté' },
  fill_all_fields: { fr: 'Veuillez remplir tous les champs obligatoires.' },
  line_short: { fr: 'Ligne' },
  stat_short: { fr: 'Stat.' },
  pal_short: { fr: 'Pal.' },
  op_short: { fr: 'Op.' },
  pin: { fr: 'PIN' },
  status: { fr: 'Status' },
  confirm: { fr: 'Confirmer' },
  delete_question: { fr: 'Supprimer ?' },
  delete_confirm_msg: { fr: 'Êtes-vous sûr de vouloir supprimer' },
  delete_irreversible: { fr: 'Cette action est irréversible.' },
  configuration: { fr: 'Configuration' },
  full_name: { fr: 'Nom complet' },
  choose_role: { fr: 'Choisir un rôle' },
  technician: { fr: 'Technicien' },
  machine_name: { fr: 'Nom de la machine' },
  line_name: { fr: 'Nom de la ligne' },
  active_service: { fr: 'Ligne en service (Activée)' },
  track_production: { fr: 'Suivi de production (Palettes)' },
  downtime_reason: { fr: 'Motif d\'arrêt' },
  select_reason: { fr: 'Sélectionner un motif' },
  description_comment: { fr: 'Description / Commentaire' },
  program_name: { fr: 'Nom du programme' },
  choose_machine: { fr: 'Choisir Machine' },
  choose_line: { fr: 'Choisir Ligne' },
  technical_parameters: { fr: 'Paramètres Techniques' },
  exports: { fr: 'Exports & Rapports' },
  export: { fr: 'Exporter (Excel)' },
  select_operator: { fr: 'Choisir un opérateur' },
  add_downtime_log: { fr: 'Saisir un arrêt manuel' },
  production_logs_desc: { fr: 'Historique détaillé des palettes déclarées.' },
  downtime_analysis_desc: { fr: 'Analyse des temps d\'arrêt et pannes.' },
  assign_program: { fr: 'Assigner Programme' },
  new_program: { fr: 'Nouveau Programme' },
  or_choose_active: { fr: 'Ou choisir parmi les programmes actifs' },
  program_ready: { fr: 'Programme prêt' },
  no_program_available: { fr: 'Aucun autre programme disponible.' },
  machine_stop: { fr: 'Arrêt de Machine' },
  general_stop: { fr: 'Action: Stop général sur toute la machine' },
  add_manual_stop: { fr: 'Ajouter Arret Manuel' },
  total_duration: { fr: 'Durée Totale' },
  comments: { fr: 'Commentaires' },
  validate: { fr: 'Valider' },
  missing_fields: { fr: 'Champs obligatoires manquants.' },
  initialization: { fr: 'Initialisation...' },
  system_prep: { fr: 'Préparation du système industriel' },
  access_denied: { fr: 'Accès Refusé: Rôle inconnu' },
  error_saving: { fr: 'Erreur lors de l\'enregistrement.' },
  error_deleting: { fr: 'Erreur: Impossible de supprimer cet élément.' },
  production_report_title: { fr: 'RAPPORT DE PRODUCTION - FACTORYTRACK PRO' },
  downtime_report_title: { fr: 'ANALYSE DES ARRÊTS (DOWNTIME)' },
  actions: { fr: 'Actions' },
  production_of: { fr: 'Production de' },
  stop_recorded: { fr: 'Arrêt' },
  
  // Filters
  filter: { fr: 'Filtrer' },
  date: { fr: 'Date' },
  all_machines: { fr: 'Toutes les machines' },
  all_lines: { fr: 'Toutes les lignes' },
  all_shifts: { fr: 'Toutes les équipes' },
  all_operators: { fr: 'Tous les opérateurs' },
  new_pin_placeholder: { fr: 'Nouveau PIN (Laissez vide pour conserver)' }
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('fr');

  useEffect(() => {
    document.dir = 'ltr';
    document.documentElement.lang = 'fr';
  }, []);

  const t = (key: string) => {
    return translations[key]?.['fr'] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
